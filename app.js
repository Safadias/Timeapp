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
function saveDB() {
  localStorage.setItem('eltimer_db', JSON.stringify(db));
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
  loadDB();
  document.getElementById('nav-dashboard').addEventListener('click', showDashboard);
  document.getElementById('nav-customers').addEventListener('click', showCustomers);
  document.getElementById('nav-projects').addEventListener('click', showProjects);
  document.getElementById('nav-times').addEventListener('click', showTimes);
  document.getElementById('nav-materials').addEventListener('click', showMaterials);
  // Rapport knap erstatter fakturaer
  const reportBtn = document.getElementById('nav-report');
  if (reportBtn) reportBtn.addEventListener('click', showReport);
  document.getElementById('nav-settings').addEventListener('click', showSettings);
  showDashboard();
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
  const times = db.times.slice().sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,5);
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
  // liste
  if (db.customers.length) {
    let html = '<table><thead><tr><th>Navn</th><th>Adresse</th><th>Email</th><th>Telefon</th><th></th></tr></thead><tbody>';
    for (const c of db.customers) {
      html += `<tr><td>${c.name}</td><td>${c.address || ''}</td><td>${c.email || ''}</td><td>${c.phone || ''}</td><td><button data-id="${c.id}" class="delete-customer">Slet</button></td></tr>`;
    }
    html += '</tbody></table>';
    view.innerHTML += html;
  } else {
    view.innerHTML += '<p>Ingen kunder endnu.</p>';
  }
  // formular til ny kunde
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
  // sletteknapper
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

// Sager: liste + formular
function showProjects() {
  const view = document.getElementById('view');
  view.innerHTML = '<h2>Sager</h2>';
  if (db.projects.length) {
    let html = '<table><thead><tr><th>Kunde</th><th>Titel</th><th>Timepris</th><th>Status</th><th>Handling</th><th></th></tr></thead><tbody>';
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
      html += `<tr><td>${cust ? cust.name : ''}</td><td>${p.title}</td><td>${p.hourPrice}</td><td>${p.status}</td><td>${actionBtn}</td><td><button data-id="${p.id}" class="delete-project">Slet</button></td></tr>`;
    }
    html += '</tbody></table>';
    view.innerHTML += html;
  } else {
    view.innerHTML += '<p>Ingen sager endnu.</p>';
  }
  // formular til ny sag
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
  // slet sag
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
  // Afslut sag knapper
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
  // Genåbn sag knapper
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
        description: data.get('description')
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
      const times = db.times.filter(t => t.projectId === p.id && t.date);
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