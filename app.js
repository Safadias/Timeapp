/*
 * El‑Timer & Faktura – Manual tidsregistrering
 *
 * Dette script styrer hele appens tilstand og brugergrænseflade. I modsætning
 * til den oprindelige version findes der ikke nogen start/stop‑timer. Du
 * registrerer timer manuelt med dato, antal timer og beskrivelse. Alle data
 * gemmes i browserens localStorage, så dine registreringer bevares mellem
 * sessions. Appen er en simpel PWA og kan installeres på hjemskærmen.
 */

// Standard database‐struktur. Bruges som fallback hvis der ikke findes data i localStorage.
const defaultDB = {
  customers: [],      // { id, name, address, email, phone }
  projects: [],       // { id, customerId, title, description, hourPrice, status }
  times: [],          // { id, projectId, date, hours, description }
  materials: [],      // { id, projectId, name, quantity, unitPrice }
  invoices: [],       // { id, number, projectId, date, subtotal, vat, total }
  settings: {
    companyName: '',
    cvr: '',
    address: '',
    defaultHourPrice: '',
    vatRate: 25
  },
  nextInvoiceNumber: 1
};

let db = {};

/*
 * Supabase integration for cloud storage and login
 *
 * For at kunne dele data mellem flere enheder skal appen bruge en ekstern
 * database. Vi bruger Supabase som backend‑tjeneste til autentifikation og
 * lagring af hele databasen som et JSON‑felt. Udfyld nedenstående konstanter
 * med URL og anonym nøgle fra dit Supabase‑projekt for at aktivere funktionen.
 * Se https://supabase.com/ for at oprette et gratis projekt og få dine nøgler.
 */

// TODO: erstat med din Supabase URL (uden bag/)
const SUPABASE_URL = 'https://YOUR_SUPABASE_URL.supabase.co';
// TODO: erstat med din offentlige anonyme nøgle (anon key)
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Initialiser Supabase‑klient kun hvis bibliotekt er tilgængeligt og variablerne
// ikke er efterladt som placeholders. Vi tjekker på 'YOUR_' for at afgøre
// om udvikleren har udfyldt URL og nøgle. Hvis de indeholder 'YOUR',
// betragtes de som ikke konfigureret og appen kører i offline‑tilstand.
let supabaseClient = null;
if (
  typeof supabase !== 'undefined' &&
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('YOUR') &&
  !SUPABASE_ANON_KEY.includes('YOUR')
) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Den aktuelle bruger efter login
let currentUser = null;
// Den virksomhed (company) som denne session arbejder på
// For multi‑tenant support gemmer vi en company_id og rolle, som bruges til
// at filtrere data og styre rettigheder. En bruger kan være medlem af flere
// virksomheder (company_members table), men vælger én ad gangen.
let currentCompanyId = null;
let currentRole = null; // 'admin' eller 'employee'

/**
 * Hent database fra Supabase for den aktuelle bruger. Hvis der findes data,
 * overskrives den lokale db (efter merge med defaultDB) og gemmes i
 * localStorage (uden at trigge ny remote‑gemning). Hvis der ikke findes
 * nogen post for brugeren, oprettes en ny post med den nuværende lokale db.
 */
/**
 * Hent database fra Supabase for den valgte virksomhed (currentCompanyId).
 * Hvis der findes data, overskrives den lokale db (efter merge med defaultDB)
 * og gemmes i localStorage (uden at trigge ny remote‑gemning). Hvis der
 * ikke findes nogen post for virksomheden, oprettes en ny post med den
 * nuværende lokale db. Denne funktion kaldes efter at brugeren har valgt
 * virksomhed (loadMemberships → selectCompany).
 */
async function loadCompanyData() {
  if (!supabaseClient || !currentUser || !currentCompanyId) return;
  try {
    const { data, error } = await supabaseClient
      .from('company_data')
      .select('data')
      .eq('company_id', currentCompanyId)
      .maybeSingle();
    if (error) {
      console.error('Fejl ved hentning af company data:', error);
      return;
    }
    if (data && data.data) {
      try {
        const remote = JSON.parse(data.data);
        db = Object.assign({}, defaultDB, remote);
        saveDB(true);
      } catch (parseErr) {
        console.error('Fejl ved parsing af company data:', parseErr);
      }
    } else {
      // Ingen post for denne virksomhed – opret én med den aktuelle db
      await supabaseClient
        .from('company_data')
        .insert({ company_id: currentCompanyId, data: JSON.stringify(db) });
    }
  } catch (err) {
    console.error('Uventet fejl i loadCompanyData:', err);
  }
}

/**
 * Gem den aktuelle db til Supabase for den valgte virksomhed. Kaldes
 * automatisk efter hver lokal gemning hvis en bruger er logget ind og
 * har valgt en virksomhed. Hvis der opstår fejl, logges de til
 * konsollen. Der ventes ikke på at gemningen er færdig i UI.
 */
async function saveRemoteDB() {
  if (!supabaseClient || !currentUser || !currentCompanyId) return;
  try {
    await supabaseClient
      .from('company_data')
      .upsert({ company_id: currentCompanyId, data: JSON.stringify(db) });
  } catch (err) {
    console.error('Fejl ved gemning til company database:', err);
  }
}

/**
 * Hent liste over virksomhedstilknytninger for den aktuelle bruger. Hvis
 * brugeren ikke er medlem af nogen virksomheder, vises en formular til at
 * oprette en ny virksomhed. Hvis brugeren er medlem af én virksomhed,
 * vælges den automatisk. Hvis brugeren er medlem af flere virksomheder,
 * vises en liste, så brugeren kan vælge. Efter valg indlæses company data.
 */
async function loadMemberships() {
  if (!supabaseClient || !currentUser) return;
  try {
    // Hent memberships (company_id, role)
    const { data: mems, error: memError } = await supabaseClient
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', currentUser.id);
    if (memError) {
      console.error('Fejl ved hentning af company memberships:', memError);
      return;
    }
    if (!mems || mems.length === 0) {
      // Ingen medlemskab → vis oprettelsesformular
      showCompanyCreate();
      return;
    }
    // Hent navne på virksomheder
    const companyIds = mems.map(m => m.company_id);
    const { data: comps, error: compError } = await supabaseClient
      .from('companies')
      .select('id, name')
      .in('id', companyIds);
    if (compError) {
      console.error('Fejl ved hentning af company navne:', compError);
      return;
    }
    // Sammenkobl navne med membership
    const memberships = mems.map(m => {
      const comp = comps ? comps.find(c => c.id === m.company_id) : null;
      return {
        id: m.company_id,
        role: m.role,
        name: comp ? comp.name : m.company_id
      };
    });
    if (memberships.length === 1) {
      // Automatisk valg
      selectCompany(memberships[0].id, memberships[0].role);
      return;
    }
    // Flere memberships → lad bruger vælge
    showCompanySelection(memberships);
  } catch (err) {
    console.error('Uventet fejl i loadMemberships:', err);
  }
}

/**
 * Vælg en virksomhed og rolle. Sætter currentCompanyId og currentRole,
 * henter company data og viser dashboard. Kaldes fra UI eller automatisk.
 * @param {string} companyId
 * @param {string} role
 */
function selectCompany(companyId, role) {
  currentCompanyId = companyId;
  currentRole = role;
  loadDB();
  loadCompanyData().then(() => {
    // Vis navigation og log ud knap
    const nav = document.querySelector('nav');
    if (nav) nav.style.display = '';
    const logoutBtn = document.getElementById('nav-logout');
    if (logoutBtn) logoutBtn.style.display = '';
    showDashboard();
  });
}

/**
 * Vis en formular hvor brugeren kan oprette en ny virksomhed. Når
 * virksomheden er oprettet, tilføjes brugeren som admin og der
 * oprettes en tom company_data post. Derefter indlæses company data.
 */
function showCompanyCreate() {
  const nav = document.querySelector('nav');
  if (nav) nav.style.display = 'none';
  const view = document.getElementById('view');
  view.innerHTML = `
    <h2>Opret virksomhed</h2>
    <form id="company-create-form">
      <label>Virksomhedsnavn<br><input type="text" name="name" required></label><br>
      <button type="submit">Opret virksomhed</button>
    </form>
  `;
  const form = document.getElementById('company-create-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(form);
    const name = data.get('name');
    if (!supabaseClient) {
      alert('Supabase er ikke konfigureret. Udfyld SUPABASE_URL og SUPABASE_ANON_KEY.');
      return;
    }
    try {
      // Indsæt i companies og få id
      const { data: insertComp, error: compErr } = await supabaseClient
        .from('companies')
        .insert({ name })
        .select('id')
        .single();
      if (compErr) {
        alert('Kunne ikke oprette virksomhed: ' + compErr.message);
        return;
      }
      const companyId = insertComp.id;
      // Tilføj membership som admin
      const { error: memErr } = await supabaseClient
        .from('company_members')
        .insert({ user_id: currentUser.id, company_id: companyId, role: 'admin' });
      if (memErr) {
        alert('Kunne ikke tilføje dig som medlem: ' + memErr.message);
        return;
      }
      // Opret company_data post
      const { error: dataErr } = await supabaseClient
        .from('company_data')
        .insert({ company_id: companyId, data: JSON.stringify(defaultDB) });
      if (dataErr) {
        alert('Kunne ikke oprette databasepost for virksomhed: ' + dataErr.message);
        return;
      }
      // Vælg virksomheden
      selectCompany(companyId, 'admin');
    } catch (err) {
      console.error('Fejl ved oprettelse af virksomhed:', err);
      alert('Der opstod en uventet fejl ved oprettelse af virksomhed.');
    }
  });
}

/**
 * Vis en side hvor brugeren kan vælge hvilken virksomhed der skal bruges.
 * @param {Array<{id:string, role:string, name:string}>} memberships
 */
function showCompanySelection(memberships) {
  const nav = document.querySelector('nav');
  if (nav) nav.style.display = 'none';
  const view = document.getElementById('view');
  // Byg en select liste med virksomheder
  let options = memberships.map(m => `<option value="${m.id}">${m.name} (${m.role})</option>`).join('');
  view.innerHTML = `
    <h2>Vælg virksomhed</h2>
    <form id="select-company-form">
      <label>Virksomhed<br>
        <select name="company" required>
          ${options}
        </select>
      </label><br>
      <button type="submit">Vælg</button>
    </form>
    <p>Har du ikke en virksomhed? <a href="#" id="create-company-link">Opret en ny virksomhed</a></p>
  `;
  document.getElementById('create-company-link').addEventListener('click', e => {
    e.preventDefault();
    showCompanyCreate();
  });
  const form = document.getElementById('select-company-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const select = form.querySelector('select[name="company"]');
    const companyId = select.value;
    // Find role
    const membership = memberships.find(m => m.id === companyId);
    const role = membership ? membership.role : 'employee';
    selectCompany(companyId, role);
  });
}

/**
 * Vis login‑formular. Skjuler navigationen og lader brugeren logge ind
 * eller gå til oprettelse. Ved succesfuld login skiftes der til dashboard.
 */
function showLogin() {
  // Skjul navigation under login
  const nav = document.querySelector('nav');
  if (nav) nav.style.display = 'none';
  const view = document.getElementById('view');
  view.innerHTML = `
    <h2>Log ind</h2>
    <form id="login-form">
      <label>Email<br><input type="email" name="email" required></label><br>
      <label>Adgangskode<br><input type="password" name="password" required></label><br>
      <button type="submit">Log ind</button>
    </form>
    <p>Har du ikke en konto? <a href="#" id="show-signup">Opret en konto</a></p>
  `;
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(loginForm);
    await handleLogin(data.get('email'), data.get('password'));
  });
  const signupLink = document.getElementById('show-signup');
  signupLink.addEventListener('click', e => {
    e.preventDefault();
    showSignup();
  });
}

/**
 * Vis oprettelsesformular for ny bruger. Ved succesfuld oprettelse logges
 * brugeren automatisk ind og der oprettes en tom database i Supabase.
 */
function showSignup() {
  const nav = document.querySelector('nav');
  if (nav) nav.style.display = 'none';
  const view = document.getElementById('view');
  view.innerHTML = `
    <h2>Opret konto</h2>
    <form id="signup-form">
      <label>Email<br><input type="email" name="email" required></label><br>
      <label>Adgangskode<br><input type="password" name="password" required></label><br>
      <button type="submit">Opret</button>
    </form>
    <p>Har du allerede en konto? <a href="#" id="show-login">Log ind</a></p>
  `;
  const signupForm = document.getElementById('signup-form');
  signupForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(signupForm);
    await handleSignUp(data.get('email'), data.get('password'));
  });
  document.getElementById('show-login').addEventListener('click', e => {
    e.preventDefault();
    showLogin();
  });
}

/**
 * Log bruger ind via Supabase. Ved succes hentes data fra lokal storage og
 * Supabase og navigationsbjælken vises. Ved fejl vises en alert.
 */
async function handleLogin(email, password) {
  if (!supabaseClient) {
    alert('Supabase er ikke konfigureret. Udfyld SUPABASE_URL og SUPABASE_ANON_KEY.');
    return;
  }
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      alert('Login fejlede: ' + error.message);
      return;
    }
    currentUser = data.user;
    // Indlæs lokal data som fallback
    loadDB();
    // Hent tilknyttede virksomheder og vælg en
    await loadMemberships();
  } catch (err) {
    console.error('Login exception:', err);
    alert('Der opstod en uventet fejl ved login.');
  }
}

/**
 * Opret en ny bruger via Supabase. Ved succes logges brugeren ind og der
 * oprettes en databasepost i Supabase med den aktuelle lokale db.
 */
async function handleSignUp(email, password) {
  if (!supabaseClient) {
    alert('Supabase er ikke konfigureret. Udfyld SUPABASE_URL og SUPABASE_ANON_KEY.');
    return;
  }
  try {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
      alert('Oprettelse fejlede: ' + error.message);
      return;
    }
    currentUser = data.user;
    // Indlæs lokal db som fallback
    loadDB();
    // Der findes ingen virksomhed endnu, fortsæt til medlemskabsflow
    await loadMemberships();
  } catch (err) {
    console.error('Sign up exception:', err);
    alert('Der opstod en uventet fejl ved oprettelse.');
  }
}

/**
 * Log brugeren ud og vis login‑skærmen igen. Navigationen skjules.
 */
async function logout() {
  if (!supabaseClient) {
    showLogin();
    return;
  }
  try {
    await supabaseClient.auth.signOut();
  } catch (err) {
    console.error('Logout exception:', err);
  }
  currentUser = null;
  currentCompanyId = null;
  currentRole = null;
  showLogin();
}

// Utility: generer et simpelt unikt ID baseret på timestamp.
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Indlæs database fra localStorage eller brug default.
function loadDB() {
  const saved = localStorage.getItem('eltimer_db');
  if (saved) {
    try {
      db = JSON.parse(saved);
      // Hvis structure mangler felter efter opdateringer, merge default ind
      db = Object.assign({}, defaultDB, db);
    } catch (e) {
      console.error('Kunne ikke parse gemt data:', e);
      db = JSON.parse(JSON.stringify(defaultDB));
    }
  } else {
    db = JSON.parse(JSON.stringify(defaultDB));
  }
}

// Gem database til localStorage
/**
 * Gem database lokalt og, hvis en bruger er logget ind, også til Supabase.
 * Brug parameteren skipRemote = true for at undgå remote gemning (f.eks.
 * når data netop er hentet fra Supabase). Remote gemningen udføres
 * asynkront og påvirker ikke UI'ens reaktionstid.
 *
 * @param {boolean} [skipRemote=false] Hvis true, gemmes kun lokalt.
 */
function saveDB(skipRemote = false) {
  localStorage.setItem('eltimer_db', JSON.stringify(db));
  if (!skipRemote && currentUser) {
    // Kald remote gemning men vent ikke på at den afsluttes
    saveRemoteDB();
  }
}

// Hjælp: find kunde/projekt navn
function findCustomer(id) {
  return db.customers.find(c => c.id === id);
}
function findProject(id) {
  return db.projects.find(p => p.id === id);
}

// Rendering helper: opret optioner til select med kunde/projekt
function customerOptions(selectedId) {
  return db.customers.map(c => `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
}
function projectOptions(selectedId, filterStatus) {
  return db.projects
    .filter(p => (filterStatus ? p.status === filterStatus : true))
    .map(p => {
      const customer = findCustomer(p.customerId);
      return `<option value="${p.id}" ${selectedId === p.id ? 'selected' : ''}>${customer ? customer.name + ' – ' : ''}${p.title}</option>`;
    })
    .join('');
}

// NAVIGATION OG VISNINGER
// Opsæt navigation og initial visning
document.addEventListener('DOMContentLoaded', () => {
  // Indlæs lokale data som fallback
  loadDB();
  // Knyt navigationens knapper til visningsfunktioner
  document.getElementById('nav-dashboard').addEventListener('click', showDashboard);
  document.getElementById('nav-customers').addEventListener('click', showCustomers);
  document.getElementById('nav-projects').addEventListener('click', showProjects);
  document.getElementById('nav-times').addEventListener('click', showTimes);
  document.getElementById('nav-materials').addEventListener('click', showMaterials);
  const reportBtn = document.getElementById('nav-report');
  if (reportBtn) reportBtn.addEventListener('click', showReport);
  document.getElementById('nav-settings').addEventListener('click', showSettings);
  // Tilføj logout event
  const logoutBtn = document.getElementById('nav-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => { logout(); });
  // Som udgangspunkt skjules navigationen indtil login/konfig
  const nav = document.querySelector('nav');
  if (nav) nav.style.display = 'none';
  // Hvis Supabase er konfigureret, tjek om der er en aktiv session
  if (supabaseClient) {
    supabaseClient.auth.getSession().then(({ data }) => {
      const session = data ? data.session : null;
      if (session) {
        currentUser = session.user;
        // Indlæs lokal fallback
        loadDB();
        // Hent virksomhedsmedlemskaber og vælg virksomhed
        loadMemberships();
      } else {
        // Ingen session → vis login
        showLogin();
      }
    });
  } else {
    // Supabase ikke konfigureret → brug lokal lagring og vis app uden login
    if (nav) nav.style.display = '';
    // Log ud knap skjules når der ikke er login
    if (logoutBtn) logoutBtn.style.display = 'none';
    showDashboard();
  }
});

// Dashboard: vis summarisk overblik
function showDashboard() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  const div = document.createElement('div');
  div.innerHTML = `
    <h2>Dashboard</h2>
    <p>Du har <strong>${db.customers.length}</strong> kunder, <strong>${db.projects.length}</strong> sager, <strong>${db.times.length}</strong> timeregistreringer og <strong>${db.materials.length}</strong> materialer.</p>
  `;
  // Vis seneste 5 timeregistreringer
  // Hvis rollen er employee, vis kun brugerens egne timer
  const times = db.times
    .filter(t => currentRole === 'admin' || (currentUser && t.userId === currentUser.id))
    .slice()
    .sort((a,b) => new Date(b.date) - new Date(a.date))
    .slice(0,5);
  if (times.length) {
    let html = '<h3>Seneste timeregistreringer</h3><table><thead><tr><th>Dato</th><th>Sag</th><th>Timer</th><th>Beskrivelse</th></tr></thead><tbody>';
    for (const t of times) {
      const proj = findProject(t.projectId);
      html += `<tr><td>${t.date}</td><td>${proj ? proj.title : ''}</td><td>${t.hours}</td><td>${t.description || ''}</td></tr>`;
    }
    html += '</tbody></table>';
    div.innerHTML += html;
  }
  view.appendChild(div);
}

// Kunder: liste + formular
function showCustomers() {
  const view = document.getElementById('view');
  view.innerHTML = '<h2>Kunder</h2>';
  const canEdit = currentRole === 'admin';
  // liste
  if (db.customers.length) {
    let html = '<table><thead><tr><th>Navn</th><th>Adresse</th><th>Email</th><th>Telefon</th>';
    if (canEdit) html += '<th></th>';
    html += '</tr></thead><tbody>';
    for (const c of db.customers) {
      html += `<tr><td>${c.name}</td><td>${c.address || ''}</td><td>${c.email || ''}</td><td>${c.phone || ''}</td>`;
      if (canEdit) html += `<td><button data-id="${c.id}" class="delete-customer">Slet</button></td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    view.innerHTML += html;
  } else {
    view.innerHTML += '<p>Ingen kunder endnu.</p>';
  }
  // formular til ny kunde (kun admin)
  if (canEdit) {
    const form = document.createElement('form');
    form.innerHTML = `
      <h3>Ny kunde</h3>
      <label>Navn<br><input type="text" name="name" required></label><br>
      <label>Adresse<br><input type="text" name="address"></label><br>
      <label>Email<br><input type="email" name="email"></label><br>
      <label>Telefon<br><input type="tel" name="phone"></label><br>
      <button type="submit">Tilføj kunde</button>
    `;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = new FormData(form);
      db.customers.push({
        id: generateId(),
        name: data.get('name'),
        address: data.get('address'),
        email: data.get('email'),
        phone: data.get('phone')
      });
      saveDB();
      showCustomers();
    });
    view.appendChild(form);
  }
  // sletteknapper (kun admin)
  if (canEdit) {
    view.querySelectorAll('.delete-customer').forEach(btn => {
      btn.addEventListener('click', e => {
        const id = btn.getAttribute('data-id');
        // fjern projekter og registreringer tilknyttet kunden
        db.projects = db.projects.filter(p => p.customerId !== id);
        db.times = db.times.filter(t => findProject(t.projectId));
        db.materials = db.materials.filter(m => findProject(m.projectId));
        db.customers = db.customers.filter(c => c.id !== id);
        saveDB();
        showCustomers();
      });
    });
  }
}

// Sager: liste + formular
function showProjects() {
  const view = document.getElementById('view');
  view.innerHTML = '<h2>Sager</h2>';
  const canEdit = currentRole === 'admin';
  if (db.projects.length) {
    let html = '<table><thead><tr><th>Kunde</th><th>Titel</th><th>Timepris</th><th>Status</th><th>Handling</th>';
    if (canEdit) html += '<th></th>';
    html += '</tr></thead><tbody>';
    for (const p of db.projects) {
      const cust = findCustomer(p.customerId);
      // Knappen til at afslutte eller genåbne sag.
      // Alle andre statusser end "open" betragtes som lukkede og kan genåbnes.
      let actionBtn = '';
      if (p.status === 'open') {
        actionBtn = `<button data-id="${p.id}" class="finish-project">Afslut</button>`;
      } else {
        actionBtn = `<button data-id="${p.id}" class="reopen-project">Åbn igen</button>`;
      }
      html += `<tr><td>${cust ? cust.name : ''}</td><td>${p.title}</td><td>${p.hourPrice}</td><td>${p.status}</td><td>${actionBtn}</td>`;
      if (canEdit) html += `<td><button data-id="${p.id}" class="delete-project">Slet</button></td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    view.innerHTML += html;
  } else {
    view.innerHTML += '<p>Ingen sager endnu.</p>';
  }
  // formular til ny sag (kun admin)
  if (canEdit) {
    const form = document.createElement('form');
    form.innerHTML = `
      <h3>Ny sag</h3>
      <label>Kunde<br><select name="customerId" required>${customerOptions()}</select></label><br>
      <label>Titel<br><input type="text" name="title" required></label><br>
      <label>Beskrivelse<br><textarea name="description"></textarea></label><br>
      <label>Timepris<br><input type="number" name="hourPrice" step="0.01" value="${db.settings.defaultHourPrice || ''}"></label><br>
      <button type="submit">Tilføj sag</button>
    `;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = new FormData(form);
      db.projects.push({
        id: generateId(),
        customerId: data.get('customerId'),
        title: data.get('title'),
        description: data.get('description'),
        hourPrice: parseFloat(data.get('hourPrice')) || 0,
        status: 'open' // nye sager starter som åbne
      });
      saveDB();
      showProjects();
    });
    view.appendChild(form);
  }
  // slet sag (kun admin)
  if (canEdit) {
    view.querySelectorAll('.delete-project').forEach(btn => {
      btn.addEventListener('click', e => {
        const id = btn.getAttribute('data-id');
        db.projects = db.projects.filter(p => p.id !== id);
        db.times = db.times.filter(t => t.projectId !== id);
        db.materials = db.materials.filter(m => m.projectId !== id);
        saveDB();
        showProjects();
      });
    });
  }
  // Afslut sag knapper (for både admin og employee)
  view.querySelectorAll('.finish-project').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const proj = findProject(id);
      if (proj) {
        proj.status = 'finished';
        saveDB();
        showProjects();
      }
    });
  });
  // Genåbn sag knapper (for både admin og employee)
  view.querySelectorAll('.reopen-project').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const proj = findProject(id);
      if (proj) {
        proj.status = 'open';
        saveDB();
        showProjects();
      }
    });
  });
}

// Timer: liste + formular (manuel registrering)
function showTimes() {
  const view = document.getElementById('view');
  view.innerHTML = '<h2>Timer</h2>';
  /*
   * Vi viser ikke længere eksisterende timeregistreringer her, for at
   * undgå forvirring. I stedet fokuserer denne side på at oprette nye
   * registreringer. Hvis du vil se en oversigt over alle timer, kan du
   * lave en rapport via rapportfunktionen.
   */
  // Find alle åbne projekter. Kun for disse kan man registrere timer.
  const openProjects = db.projects.filter(p => p.status === 'open');
  if (openProjects.length === 0) {
    view.innerHTML += '<p>Ingen åbne sager. Opret eller genåbn en sag først.</p>';
    return;
  }
  // Formular til ny timeregistrering
  const form = document.createElement('form');
  form.innerHTML = `
    <h3>Ny timeregistrering</h3>
    <label>Sag<br><select name="projectId" required>${projectOptions('', 'open')}</select></label><br>
    <label>Dato<br><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}" required></label><br>
    <label>Mødt kl.<br><input type="time" name="start" required></label><br>
    <label>Slut kl.<br><input type="time" name="end" required></label><br>
    <label>Pause (minutter)<br><input type="number" name="break" step="1" value="0" required></label><br>
    <label>Beskrivelse<br><textarea name="description"></textarea></label><br>
    <button type="submit">Tilføj tid</button>
  `;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    const projectId = data.get('projectId');
    const date = data.get('date');
    const start = data.get('start');
    const end = data.get('end');
    const breakMin = parseFloat(data.get('break')) || 0;
    // Beregn antal timer som difference mellem start og slut minus pause
    try {
      const startDateTime = new Date(`${date}T${start}`);
      const endDateTime = new Date(`${date}T${end}`);
      let diffMinutes = (endDateTime - startDateTime) / (1000 * 60);
      diffMinutes -= breakMin;
      if (diffMinutes < 0) diffMinutes = 0;
      const hours = diffMinutes / 60;
      db.times.push({
        id: generateId(),
        projectId: projectId,
        date: date,
        start: start,
        end: end,
        breakMinutes: breakMin,
        hours: hours,
        description: data.get('description'),
        // Gem brugerens ID så vi kan filtrere på medarbejdere senere
        userId: currentUser ? currentUser.id : null
      });
      saveDB();
      showTimes();
    } catch (err) {
      alert('Der opstod en fejl ved beregning af timer.');
    }
  });
  view.appendChild(form);
}

// Materialer: liste + formular
function showMaterials() {
  const view = document.getElementById('view');
  view.innerHTML = '<h2>Materialer</h2>';
  if (db.materials.length) {
    let html = '<table><thead><tr><th>Sag</th><th>Navn</th><th>Antal</th><th>Enhedspris</th><th>Sum</th><th>Dato</th><th></th></tr></thead><tbody>';
    for (const m of db.materials) {
      const proj = findProject(m.projectId);
      const sum = m.quantity * m.unitPrice;
      html += `<tr><td>${proj ? proj.title : ''}</td><td>${m.name}</td><td>${m.quantity}</td><td>${m.unitPrice.toFixed(2)}</td><td>${sum.toFixed(2)}</td><td>${m.date || ''}</td><td><button data-id="${m.id}" class="delete-material">Slet</button></td></tr>`;
    }
    html += '</tbody></table>';
    view.innerHTML += html;
  } else {
    view.innerHTML += '<p>Ingen materialer registreret endnu.</p>';
  }
  const form = document.createElement('form');
  form.innerHTML = `
    <h3>Nyt materiale</h3>
    <label>Sag<br><select name="projectId" required>${projectOptions()}</select></label><br>
    <label>Navn<br><input type="text" name="name" required></label><br>
    <label>Antal<br><input type="number" name="quantity" step="1" required></label><br>
    <label>Enhedspris<br><input type="number" name="unitPrice" step="0.01" required></label><br>
    <label>Dato<br><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}" required></label><br>
    <button type="submit">Tilføj materiale</button>
  `;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    db.materials.push({
      id: generateId(),
      projectId: data.get('projectId'),
      name: data.get('name'),
      quantity: parseFloat(data.get('quantity')), 
      unitPrice: parseFloat(data.get('unitPrice')),
      date: data.get('date')
    });
    saveDB();
    showMaterials();
  });
  view.appendChild(form);
  // slet materiale
  view.querySelectorAll('.delete-material').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      db.materials = db.materials.filter(m => m.id !== id);
      saveDB();
      showMaterials();
    });
  });
}

// Fakturaer: liste + generering
function showInvoices() {
  const view = document.getElementById('view');
  view.innerHTML = '<h2>Fakturaer</h2>';
  if (db.invoices.length) {
    let html = '<table><thead><tr><th>Nr.</th><th>Sag</th><th>Dato</th><th>Subtotal</th><th>Moms</th><th>Total</th><th></th></tr></thead><tbody>';
    for (const inv of db.invoices) {
      const proj = findProject(inv.projectId);
      html += `<tr><td>${inv.number}</td><td>${proj ? proj.title : ''}</td><td>${inv.date}</td><td>${inv.subtotal.toFixed(2)}</td><td>${inv.vat.toFixed(2)}</td><td>${inv.total.toFixed(2)}</td><td><button data-id="${inv.id}" class="view-invoice">Vis</button></td></tr>`;
    }
    html += '</tbody></table>';
    view.innerHTML += html;
  } else {
    view.innerHTML += '<p>Ingen fakturaer endnu.</p>';
  }
  // formular til generering af ny faktura
  const form = document.createElement('form');
  form.innerHTML = `
    <h3>Generer faktura</h3>
    <label>Sag<br><select name="projectId" required>${projectOptions('','finished')}</select></label><br>
    <button type="submit">Generer faktura</button>
  `;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    const projectId = data.get('projectId');
    const proj = findProject(projectId);
    if (!proj) return;
    generateInvoice(proj);
    showInvoices();
  });
  view.appendChild(form);
  // vis faktura
  view.querySelectorAll('.view-invoice').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const invoice = db.invoices.find(inv => inv.id === id);
      if (invoice) {
        showInvoiceDetails(invoice);
      }
    });
  });
}

function generateInvoice(project) {
  // Beregn timer og materialer for projekt
  const times = db.times.filter(t => t.projectId === project.id);
  const mats = db.materials.filter(m => m.projectId === project.id);
  let subtotal = 0;
  for (const t of times) {
    subtotal += t.hours * (project.hourPrice || db.settings.defaultHourPrice);
  }
  for (const m of mats) {
    subtotal += m.quantity * m.unitPrice;
  }
  const vat = subtotal * (db.settings.vatRate / 100);
  const total = subtotal + vat;
  const invoice = {
    id: generateId(),
    number: db.nextInvoiceNumber++,
    projectId: project.id,
    date: new Date().toISOString().slice(0,10),
    subtotal: subtotal,
    vat: vat,
    total: total
  };
  db.invoices.push(invoice);
  project.status = 'invoiced';
  saveDB();
  alert('Faktura #' + invoice.number + ' genereret.');
}

// Vis detaljer for en faktura som en simpel rapport
function showInvoiceDetails(inv) {
  const view = document.getElementById('view');
  const proj = findProject(inv.projectId);
  const cust = proj ? findCustomer(proj.customerId) : null;
  view.innerHTML = `
    <h2>Faktura #${inv.number}</h2>
    <p><strong>Dato:</strong> ${inv.date}</p>
    <h3>Kunde</h3>
    <p>${cust ? cust.name : ''}<br>${cust ? cust.address || '' : ''}</p>
    <h3>Sag</h3>
    <p>${proj ? proj.title : ''}<br>${proj ? proj.description || '' : ''}</p>
    <h3>Timer</h3>
    <table><thead><tr><th>Dato</th><th>Timer</th><th>Beskrivelse</th><th>Pris (kr)</th></tr></thead><tbody>
      ${db.times.filter(t => t.projectId === inv.projectId).map(t => {
        const price = (proj.hourPrice || db.settings.defaultHourPrice) * t.hours;
        return `<tr><td>${t.date}</td><td>${t.hours}</td><td>${t.description || ''}</td><td>${price.toFixed(2)}</td></tr>`;
      }).join('')}
    </tbody></table>
    <h3>Materialer</h3>
    <table><thead><tr><th>Navn</th><th>Antal</th><th>Enhedspris</th><th>Pris (kr)</th></tr></thead><tbody>
      ${db.materials.filter(m => m.projectId === inv.projectId).map(m => {
        const price = m.quantity * m.unitPrice;
        return `<tr><td>${m.name}</td><td>${m.quantity}</td><td>${m.unitPrice.toFixed(2)}</td><td>${price.toFixed(2)}</td></tr>`;
      }).join('')}
    </tbody></table>
    <h3>Opsummering</h3>
    <p>Subtotal: ${inv.subtotal.toFixed(2)} kr<br>Moms (${db.settings.vatRate}%): ${inv.vat.toFixed(2)} kr<br><strong>Total: ${inv.total.toFixed(2)} kr</strong></p>
    <button id="back-to-invoices">Tilbage til fakturaoversigt</button>
  `;
  document.getElementById('back-to-invoices').addEventListener('click', showInvoices);
}

// Indstillinger: formular til firmaoplysninger, standard timepris og moms
function showSettings() {
  const view = document.getElementById('view');
  view.innerHTML = '<h2>Indstillinger</h2>';
  const form = document.createElement('form');
  form.innerHTML = `
    <label>Firmanavn<br><input type="text" name="companyName" value="${db.settings.companyName}"></label><br>
    <label>CVR<br><input type="text" name="cvr" value="${db.settings.cvr}"></label><br>
    <label>Adresse<br><input type="text" name="address" value="${db.settings.address}"></label><br>
    <label>Standard timepris<br><input type="number" name="defaultHourPrice" step="0.01" value="${db.settings.defaultHourPrice}"></label><br>
    <label>Moms (%)<br><input type="number" name="vatRate" step="0.01" value="${db.settings.vatRate}"></label><br>
    <button type="submit">Gem indstillinger</button>
  `;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    db.settings.companyName = data.get('companyName');
    db.settings.cvr = data.get('cvr');
    db.settings.address = data.get('address');
    db.settings.defaultHourPrice = parseFloat(data.get('defaultHourPrice')) || 0;
    db.settings.vatRate = parseFloat(data.get('vatRate')) || 0;
    saveDB();
    alert('Indstillinger gemt.');
  });
  view.appendChild(form);

  // Backup og gendan data
  const backupDiv = document.createElement('div');
  backupDiv.innerHTML = `
    <h3>Data backup</h3>
    <p>Eksporter dine data til en JSON‑fil for at gemme en backup eller overføre til en anden enhed. Importer en tidligere backup for at indlæse data igen. Bemærk at en import overskriver eksisterende data.</p>
    <button id="export-data">Eksporter data</button>
    <button id="import-data-btn">Importer data</button>
    <input type="file" id="import-data-file" accept="application/json" style="display:none;">
  `;
  view.appendChild(backupDiv);
  // Eksporter data
  const exportBtn = document.getElementById('export-data');
  exportBtn.addEventListener('click', () => {
    const dataStr = JSON.stringify(db, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0,10);
    a.download = `eltimer_backup_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
  // Importer data
  const importBtn = document.getElementById('import-data-btn');
  const importInput = document.getElementById('import-data-file');
  importBtn.addEventListener('click', () => {
    importInput.value = '';
    importInput.click();
  });
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const imported = JSON.parse(event.target.result);
        // Merge imported data over defaultDB to ensure structure
        db = Object.assign({}, defaultDB, imported);
        saveDB();
        alert('Data importeret. Opdater siden for at se ændringer.');
      } catch (err) {
        alert('Kunne ikke importere filen. Sørg for at det er en gyldig backup.');
      }
    };
    reader.readAsText(file);
  });
}

// Rapport: vælg kunder og periode og generer oversigt, som kan printes som PDF
function showReport() {
  const view = document.getElementById('view');
  view.innerHTML = '<h2>Rapport</h2>';
  // Beregn standard datoer: tidligste og seneste
  let allDates = [];
  db.times.forEach(t => { if (t.date) allDates.push(t.date); });
  db.materials.forEach(m => { if (m.date) allDates.push(m.date); });
  let defaultStart = allDates.length ? allDates.reduce((a,b) => a < b ? a : b) : new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);
  let defaultEnd = allDates.length ? allDates.reduce((a,b) => a > b ? a : b) : new Date().toISOString().slice(0,10);
  // Formular til valg
  const form = document.createElement('form');
  form.id = 'report-form';
  form.innerHTML = `
    <label>Kunder (vælg en eller flere)<br>
      <select name="customers" multiple size="${Math.min(5, db.customers.length || 5)}" required>
        ${customerOptions()}
      </select>
    </label><br>
    <label>Startdato<br><input type="date" name="start" value="${defaultStart}"></label><br>
    <label>Slutdato<br><input type="date" name="end" value="${defaultEnd}"></label><br>
    <button type="submit">Vis rapport</button>
  `;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const select = form.querySelector('select[name="customers"]');
    const selectedIds = Array.from(select.selectedOptions).map(o => o.value);
    const start = form.querySelector('input[name="start"]').value;
    const end = form.querySelector('input[name="end"]').value;
    if (!selectedIds.length) {
      alert('Vælg mindst én kunde.');
      return;
    }
    generateReport(selectedIds, start, end);
  });
  view.appendChild(form);
  // Container til rapport
  const reportContainer = document.createElement('div');
  reportContainer.id = 'report-container';
  view.appendChild(reportContainer);
}

function generateReport(customerIds, startDate, endDate) {
  const container = document.getElementById('report-container');
  container.innerHTML = '';
  // Konverter datoer til Date objekter
  const start = new Date(startDate);
  const end = new Date(endDate);
  // Lav en udskriftlig rapport
  let html = '';
  for (const custId of customerIds) {
    const cust = findCustomer(custId);
    if (!cust) continue;
    html += `<h3>${cust.name}</h3>`;
    html += `<p>${cust.address || ''} ${cust.email ? '<br>Email: ' + cust.email : ''} ${cust.phone ? '<br>Telefon: ' + cust.phone : ''}</p>`;
    // Find projekter til denne kunde
    const projects = db.projects.filter(p => p.customerId === cust.id);
    if (!projects.length) {
      html += '<p>Ingen sager for denne kunde.</p>';
      continue;
    }
    for (const p of projects) {
      html += `<h4>${p.title}</h4>`;
      // Saml timer for perioden
      // Hvis brugeren ikke er admin, begræns til egne timeregistreringer
      const times = db.times.filter(t => {
        if (!t.date) return false;
        if (t.projectId !== p.id) return false;
        // ansatte ser kun egne timer
        if (currentRole !== 'admin' && currentUser) {
          return t.userId === currentUser.id;
        }
        return true;
      });
      const filteredTimes = times.filter(t => {
        const d = new Date(t.date);
        return d >= start && d <= end;
      });
      // Gruppe timer efter måned
      const monthlyHours = {};
      filteredTimes.forEach(t => {
        const month = t.date.slice(0,7); // YYYY-MM
        if (!monthlyHours[month]) monthlyHours[month] = 0;
        monthlyHours[month] += t.hours;
      });
      // Saml materialer for perioden
      const mats = db.materials.filter(m => m.projectId === p.id && m.date);
      const filteredMats = mats.filter(m => {
        const d = new Date(m.date);
        return d >= start && d <= end;
      });
      // Gruppe materialer efter måned (antal og pris)
      const monthlyMats = {};
      filteredMats.forEach(m => {
        const month = m.date.slice(0,7);
        if (!monthlyMats[month]) monthlyMats[month] = { count: 0, cost: 0 };
        monthlyMats[month].count += m.quantity;
        monthlyMats[month].cost += m.quantity * m.unitPrice;
      });
      // Lav tabel for månedlig oversigt
      const months = Array.from(new Set([...Object.keys(monthlyHours), ...Object.keys(monthlyMats)])).sort();
      if (months.length) {
        html += '<table><thead><tr><th>Måned</th><th>Timer</th><th>Materialer (stk)</th><th>Materiale sum (kr)</th></tr></thead><tbody>';
        for (const month of months) {
          const hrs = monthlyHours[month] || 0;
          const matCount = monthlyMats[month] ? monthlyMats[month].count : 0;
          const matCost = monthlyMats[month] ? monthlyMats[month].cost : 0;
          html += `<tr><td>${month}</td><td>${hrs.toFixed(2)}</td><td>${matCount}</td><td>${matCost.toFixed(2)}</td></tr>`;
        }
        html += '</tbody></table>';
      } else {
        html += '<p>Ingen registreringer i valgt periode.</p>';
      }

      // Dagsoversigt for timer (viser hver dag og antal timer)
      if (filteredTimes.length) {
        // Grupper timer per dag og beregn total
        const dailyHours = {};
        let totalHours = 0;
        filteredTimes.forEach(t => {
          if (!dailyHours[t.date]) dailyHours[t.date] = 0;
          dailyHours[t.date] += t.hours;
          totalHours += t.hours;
        });
        const days = Object.keys(dailyHours).sort();
        html += '<h5>Dagsoversigt</h5>';
        html += '<table><thead><tr><th>Dato</th><th>Timer</th></tr></thead><tbody>';
        for (const d of days) {
          html += `<tr><td>${d}</td><td>${dailyHours[d].toFixed(2)}</td></tr>`;
        }
        html += '</tbody></table>';
        html += `<p><strong>Samlet antal timer: ${totalHours.toFixed(2)}</strong></p>`;
      }
      // Liste over materialer
      if (filteredMats.length) {
        html += '<h5>Materialeliste</h5>';
        html += '<table><thead><tr><th>Dato</th><th>Navn</th><th>Antal</th><th>Enhedspris</th><th>Pris (kr)</th></tr></thead><tbody>';
        filteredMats.forEach(m => {
          const price = m.quantity * m.unitPrice;
          html += `<tr><td>${m.date}</td><td>${m.name}</td><td>${m.quantity}</td><td>${m.unitPrice.toFixed(2)}</td><td>${price.toFixed(2)}</td></tr>`;
        });
        html += '</tbody></table>';
      }
    }
  }
  if (!html) {
    html = '<p>Ingen data for valgt periode og kunder.</p>';
  }
  // Tilføj Print knap
  html += '<button id="print-report" class="no-print">Print/PDF</button>';
  container.innerHTML = html;
  const printBtn = document.getElementById('print-report');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }
}