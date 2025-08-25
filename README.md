# El‑Timer & Faktura (manuel version)

Denne app er en forenklet version af El‑Timer & Faktura. Den er designet til håndværkere, der ønsker at registrere arbejdstid og materialer manuelt og generere fakturaer uden brug af start/stop‑timere.

## Funktioner

- **Kunder:** Opret, vis og slet kunder med navn, adresse, email og telefon.
- **Sager:** Opret, vis og slet sager (projekter) knyttet til kunder. Indtast timepris og status.
- **Timer:** Registrér timer manuelt med dato, antal timer og beskrivelse. Timer knyttes til en sag.
- **Materialer:** Registrér forbrug af materialer med antal og enhedspris pr. sag.
- **Fakturaer:** Generér fakturaer baseret på timer og materialer for færdige sager. Fakturaer opsummerer linjerne og viser subtotal, moms og total.
- **Indstillinger:** Indtast firmanavn, CVR, adresse, standard timepris og moms­sats.
- **Dashboard:** Overblik over antal kunder, sager, timer, materialer og fakturaer samt de seneste timeregistreringer.
- **Offline/PWA:** Appen kan installeres på din enhed og fungerer offline via en service worker.

## Brug

1. Udpak ZIP‑filen og åbn `index.html` i din browser.
2. Tilføj først dine firmainformationer under **Indstillinger**.
3. Opret kunder og derefter sager. Når du opretter en sag kan du angive timepris og status.
4. Registrér timer og materialer på sagerne via **Timer** og **Materialer**.
5. Når en sag er færdig, ændrer du status til **Færdig** under Sager.
6. Under **Fakturaer** kan du vælge en færdig sag og generere en faktura. Fakturaer gemmes i oversigten, og du kan se detaljer.

Appen gemmer alle data lokalt i browseren (localStorage). Hvis du ønsker at starte forfra, kan du rydde localStorage manuelt via browserens udviklingsværktøjer.

## Bemærk

Denne version indeholder ingen start/stop timer. Du registrerer selv antal timer direkte i formularen.