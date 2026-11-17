# Hinweise für Claude

- Reisebande läuft als Cloudflare Worker `reisebande` (Aufbau wie `period`/Maré): `public/` statisch, `/api/*` → `server/worker.js`. Deploy per Git-Push über die Cloudflare-Git-Anbindung; `wrangler deploy` scheitert in Cloud-Sessions am Proxy.
- **Bei jeder Änderung an `public/` die Version in `public/version.txt` hochzählen** (Format `JJJJ-MM-TT.N`) und die Liste `SHELL` in `public/sw.js` aktuell halten, wenn Dateien dazukommen.
- Das Repo ist öffentlich: **keine echten Reisedaten committen** (Namen, Hotels, Flüge). Die liegen in `private/` (gitignored) und in der D1-Datenbank.
- Schema-Änderungen nur als neue Einträge in `MIGRATIONS` (`server/schema.js`), nie bestehende Statements ändern.
- Tests: `npm test`. Lokal ansehen: `npm run dev` → http://localhost:8788 (`SEED=private/…json` für Testdaten).
- Texte auf Deutsch, kurz und freundlich, keine KI-Floskeln, keine Gedankenstriche, gerade Anführungszeichen. Design: Sticker-Board (siehe Kopf von `public/style.css`), Farben der Ziele in `public/js/themes.js`.
- Die App soll Spaß machen: Stories, Swipen, Karte. Keine Aufgaben- oder Packlisten wieder einbauen (ausdrücklicher Wunsch).
- Bilder für Orte sucht der Browser (`public/js/images.js`, Wikipedia und Commons), weil Wikimedia gemeinsam genutzte Server-Adressen drosselt. Karte: MapLibre mit Vektorkacheln von OpenFreeMap, Stil in `public/js/mapstyle.js` (CARTO verlangt inzwischen einen Schlüssel).
- Secret `VAPID_PRIVATE_JWK` liegt beim Worker, nicht im Repo.
