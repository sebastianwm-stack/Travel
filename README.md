# Reisebande

Eine App, mit der Familie oder Freunde eine Reise gemeinsam planen. Sie läuft im Browser und auf dem Home-Bildschirm des iPhones und wird über Cloudflare ausgeliefert, genau wie Maré und Tropfen. Es gibt keine Konten und keine Werbung: Jede Person bekommt einen eigenen Einladungslink.

Gestaltung: "Sticker-Board". Warmes Papier, eine kräftige Kopfzeile mit Skyline, die sich nach dem Reiseziel richtet (New York, Stadt, Strand, Berge), und Kategorien als leicht schiefe Sticker. Schrift: Bricolage Grotesque.

## Was drin ist

- **Heute:** Vor der Reise ein Countdown, die Tage als Stories, ein Stapel Ideen zum Swipen, die Lieblinge der Bande und was die anderen zuletzt eingetragen haben. Während der Reise der nächste Stopp und Nachrichten an alle, zum Beispiel ein Treffpunkt.
- **Stories:** Jeder Tag ist eine Folge von Vollbild-Seiten, eine pro Stopp, in der Farbe der Kategorie. Tippen blättert weiter, nach unten wischen schließt.
- **Plan:** Der Tag als Route auf einer Vektorkarte (OpenFreeMap, flacher, bunter Stil in den App-Farben), darunter die Stopps als wischbare Karten. Die Karte folgt der Karte im Karussell. Ideen ohne Tag liegen blass im Hintergrund, damit man sieht, was in der Nähe ist. Wer lieber liest, schaltet auf Liste um. Mit **Vorschlag** verteilt die App Ideen ohne Tag so, dass nahe Orte am selben Tag landen und Ideen mit vielen Herzen zuerst drankommen; am Anreisetag beginnt der Vorschlag abends.
- **Ideen swipen:** Nach rechts heißt will ich (Herz), nach links eher nicht. Wenn alle ein Herz vergeben haben, gibt es ein Match. Daneben die Ansicht **Alle** mit Suche und Kategorien.
- **Neue Ideen:** per Google-Maps-Link (Teilen, Link kopieren, einfügen) oder per Name.
- **Google-Maps-Liste:** Unter Ideen → Alle → Abgleichen versucht die App, eine geteilte Google-Maps-Liste zu lesen. Google bietet dafür keine offizielle Schnittstelle und blockiert die Abfrage von Cloudflare aus im Moment (HTTP 429). Einzelne Orte per Link gehen immer.
- **Kommentare, Fotos, PDFs:** an jedem Ort und jedem Tag. Fotos werden vor dem Hochladen verkleinert, höchstens 20 MB pro Datei.
- **Reiseberater:** über Cloudflare Workers AI (Llama 3.3 70B, kostenloses Tageskontingent, kein API-Schlüssel). Er kennt den Plan, die Ideen, die Notizen und weiß, wer wo hinwill.
- **Abendbriefing:** Um 20 Uhr Ortszeit kommt eine Benachrichtigung mit dem Plan für morgen, am Abend vor dem Abflug nach Heimatzeit. Jede Person schaltet sie unter Infos ein, auf dem iPhone nur in der App vom Home-Bildschirm.
- **Infos:** Flüge und Hotel, die Mitreisenden, Einladen und die Einstellungen. Bewusst ohne Aufgaben- und Packlisten.
- **Wege:** Im Ablauf steht zwischen den Stopps, wie lange es dauert und mit welcher Linie (oder zu Fuß), Antippen öffnet die Verbindung in Google Maps. Die Tagesvorschläge rechnen mit denselben Zeiten. Für New York kommt das Streckennetz aus dem offiziellen MTA-Fahrplan (GTFS): Fahrzeiten tagsüber, halbe Taktzeit als Wartezeit, getrennt nach werktags, samstags und sonntags, dazu Umstiege und Fußwege zur Station. Neu bauen: GTFS von https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip entpacken, dann `node scripts/build-transit.mjs <ordner>` (schreibt `public/js/transit/nyc.js`). Andere Städte: Netz bauen und in `public/js/transit/index.js` eintragen, sonst schätzt die App nach Entfernung.
- **Offline:** Die App zeigt den letzten Stand, wenn kein Netz da ist. Schon angesehene Kartenkacheln bleiben im Speicher.

## Reisen und Einladungen

- Jede Reise ist getrennt. Man sieht nur Reisen, zu denen man eingeladen wurde.
- Die Reiseleitung erstellt unter Infos → Jemanden einladen einen Link: entweder für eine Person (gilt einmal) oder für die ganze Gruppe (beliebig oft). Beide gelten 14 Tage.
- Wer den Link öffnet, tippt den eigenen Namen an, falls die Reiseleitung die Person schon angelegt hat (offene Plätze), oder gibt einen Namen ein. Danach hat das Gerät einen persönlichen Schlüssel für diese Reise.
- Ein Gerät kann in mehreren Reisen sein. Gewechselt wird über die Pille oben in der Kopfzeile. Dort legt die Reiseleitung auch neue Reisen an.
- Ist ein Handy weg, erzeugt die Reiseleitung unter Infos einen neuen persönlichen Link für diese Person. Der alte gilt dann nicht mehr.

## Aufbau

```
wrangler.jsonc        Worker "reisebande": D1 (DB), KV (FILES), Workers AI (AI), Cron stündlich
server/worker.js      Einstieg: /api/* → api.js, sonst Dateien aus public/
server/api.js         Schnittstelle, Einladungen, persönliche Schlüssel (gespeichert ist nur der Hash)
server/schema.js      Datenbankschema; der Worker legt es beim ersten Aufruf selbst an
server/maps.js        Abgleich mit geteilten Google-Maps-Listen
server/plan.js        Tagesvorschlag (Entfernungen, Herzen)
server/ai.js          Reisebegleiter
server/briefing.js    Abendbriefing per Cron
server/push.js        Web Push (VAPID + Verschlüsselung nach RFC 8291)
public/               die App ohne Build-Schritt (plan.js Karte, story.js Stories, swipe.js Swipen), MapLibre unter public/vendor/
dev-server.mjs        lokaler Testserver (D1 über node:sqlite)
tests/                npm test
```

## Online

Die App läuft unter **https://reisebande.pages.dev**.

- **Pages-Projekt `reisebande`:** die App samt Schnittstelle. Das Worker-Bundle wird als `_worker.js` hochgeladen, die Dateien aus `public/` stecken darin (`server/static-files.js`, erzeugt von `npm run build`).
- **Worker `reisebande`:** derselbe Code, nur für das stündliche Abendbriefing (Cron), ohne öffentliche Adresse. Pages kann keine zeitgesteuerten Aufgaben.
- **Gemeinsam genutzt:** D1-Datenbank `reisebande`, KV-Speicher `reisebande-files`, Workers AI und das Secret `VAPID_PRIVATE_JWK` (beim Worker und im Pages-Projekt).

Veröffentlichen:

```bash
CLOUDFLARE_ACCOUNT_ID=… npm run deploy
```

Das Skript baut, veröffentlicht den Cron-Worker per `wrangler deploy` und lädt das Bundle über die Pages-API hoch. `wrangler pages deploy` und der normale Asset-Upload scheitern in Cloud-Sessions am Proxy, deshalb dieser Weg. Bei Änderungen an `public/` die Version in `public/version.txt` hochzählen, dann laden die installierten Apps beim nächsten Öffnen neu.

Eine neue Reise legt die Reiseleitung über die Pille oben in der Kopfzeile an. Solange es gar keine Reise gibt, zeigt die App "Neue Reise" mit der Möglichkeit, eine Reise-Datei (.json) zu laden.

## Reise-Datei (Import)

```json
{ "v": 1,
  "trip": { "name": "New York", "dest": "New York", "theme": "nyc", "start": "2026-12-17", "end": "2026-12-21",
            "tz": "America/New_York", "homeTz": "Europe/Berlin", "mapsUrl": "https://maps.app.goo.gl/…" },
  "members": [{ "key": "S", "name": "Sebastian", "role": "admin" }, { "key": "M", "name": "Mama" }],
  "places": [{ "title": "High Line", "area": "Chelsea", "cat": "Natur", "lat": 40.748, "lng": -74.0048, "approx": true, "hearts": ["M"], "by": "M" }],
  "items": [{ "kind": "flight", "title": "Condor FRA → JFK", "note": "Ankunft am Nachmittag" }] }

Personen außer der Reiseleitung werden als offene Plätze angelegt und von der jeweiligen Person über einen Einladungslink übernommen.
```

Echte Reisedaten gehören nicht ins Repo (es ist öffentlich). Dafür gibt es den Ordner `private/`, den git ignoriert.

## Lokal testen

```bash
npm run dev
```

Dann http://localhost:8788 öffnen. Mit `SEED=private/<datei>.json npm run dev` legt der Testserver die Reise an und gibt die Einladungslinks aus. Der Reisebegleiter und der Maps-Abgleich brauchen das echte Cloudflare bzw. Internet.

```bash
npm test
```
