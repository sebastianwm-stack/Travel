# Hinweise für Claude

- Reisebande läuft unter https://reisebande.pages.dev (Pages-Projekt `reisebande`, Worker-Bundle als `_worker.js`, die Dateien aus `public/` sind eingebaut). Der Worker `reisebande` läuft nur für den Cron, ohne öffentliche Adresse. Veröffentlichen: `CLOUDFLARE_ACCOUNT_ID=… npm run deploy` (siehe `scripts/deploy.sh`; das API-Token setzt in der Umgebung `travel` der Proxy ein). Kein Git-Auto-Deploy.
- Nicht die Konto-Subdomain `malou-sort` ändern: daran hängen Maré und Tropfen.
- **Bei jeder Änderung an `public/` die Version in `public/version.txt` hochzählen** (Format `JJJJ-MM-TT.N`) und die Liste `SHELL` in `public/sw.js` aktuell halten, wenn Dateien dazukommen. Neue Dateitypen in `public/` brauchen einen Eintrag in `scripts/build-static.mjs`.
- Das Repo ist öffentlich: **keine echten Reisedaten committen** (Namen, Hotels, Flüge). Die liegen in `private/` (gitignored) und in der D1-Datenbank.
- Schema-Änderungen nur als neue Einträge in `MIGRATIONS` (`server/schema.js`), nie bestehende Statements ändern. Die Datenbank ist live, jedes `CREATE` braucht `IF NOT EXISTS`.
- Tests: `npm test`. Lokal ansehen: `npm run dev` → http://localhost:8788 (`SEED=private/…json` für Testdaten).
- Texte auf Deutsch, kurz und freundlich, keine KI-Floskeln, keine Gedankenstriche, gerade Anführungszeichen. Design: Sticker-Board (siehe Kopf von `public/style.css`), Farben der Ziele in `public/js/themes.js`.
- Die App soll Spaß machen: Stories, Swipen, Karte. Keine Aufgaben- oder Packlisten wieder einbauen (ausdrücklicher Wunsch).
- Bilder für Orte sucht der Browser (`public/js/images.js`, Wikipedia und Commons), weil Wikimedia gemeinsam genutzte Server-Adressen drosselt. Karte: MapLibre mit Vektorkacheln von OpenFreeMap, Stil in `public/js/mapstyle.js` (CARTO verlangt inzwischen einen Schlüssel).
- Secret `VAPID_PRIVATE_JWK` liegt beim Worker, nicht im Repo.
