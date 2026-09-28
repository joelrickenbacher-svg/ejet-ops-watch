# E-Jet Ops Watch

Handy-App für betriebsrelevante Probleme bei Embraer E1- und E2-Jets: ADs, Groundings, Triebwerks- und Avionikthemen. Gibt es als installierbare Web-App (iPhone und Android) und als native Android-App mit Benachrichtigungen. Beide funktionieren offline und holen ihre Daten aus derselben Quelle, die sich täglich selbst aktualisiert.

## So funktioniert es

```
GitHub Action (täglich 06:30 und 17:30)          GitHub Pages
  └─ scripts/collect.mjs                           └─ die App (index.html, app.js …)
       ├─ FAA: Federal Register (offene Schnittstelle)    └─ lädt data/issues.json
       ├─ News: Google-News-Feeds (EN/DE/PT)
       ├─ Aufbereitung: GitHub Models (kostenlos), sonst Regeln
       └─ prüft und schreibt data/issues.json
```

- **Kein API-Schlüssel, keine Kosten.** Die KI-Aufbereitung nutzt GitHub Models mit dem Zugang, den jede Action automatisch hat (`permissions: models: read`).
- **Quellen:** FAA-ADs und -NPRMs zu ERJ 170/190, PW1900G und CF34 kommen vollständig direkt vom Federal Register. Nachrichten kommen aus Google-News-Suchen auf Englisch, Deutsch und Portugiesisch; ein Filter lässt nur Meldungen zu E-Jets mit Problembezug durch.
- **Quellenprüfung:** Einträge und Änderungen werden nur mit einer Quelle aus den gesammelten Kandidaten übernommen. Einträge werden nie automatisch gelöscht. Bereits verarbeitete Quellen stehen in `data/processed.json`.
- **Ohne KI** (z. B. Tageslimit erreicht): FAA-Dokumente werden mit Regeln erfasst (Originaltext, Einstufung nach Dokumenttyp), Nachrichten nur bei klaren Grounding-Meldungen.
- **Final Rule zu einem NPRM** (gleiches FAA-Docket) setzt den bestehenden Eintrag automatisch auf „In Kraft“.

## Einrichten (ca. 10 Minuten)

1. **Repository anlegen:** Auf github.com ein neues Repository erstellen (z. B. `ejet-ops-watch`, gerne privat) und den Inhalt dieses Ordners hochladen („Add file → Upload files“ oder per `git push`).
2. **Kein API-Schlüssel nötig.** Die Aktualisierung nutzt kostenlos GitHub Models.
3. **GitHub Pages einschalten:** *Settings → Pages → Build and deployment → Source: GitHub Actions*.
   Hinweis: Bei einem privaten Repository braucht Pages einen kostenpflichtigen GitHub-Plan. Sonst das Repository öffentlich machen; die Daten sind öffentliche Quellen.
4. **Erster Lauf:** *Actions → „App veröffentlichen“ → Run workflow*. Danach steht die App unter `https://<dein-name>.github.io/ejet-ops-watch/`.
5. **Auto-Update testen:** *Actions → „Daten aktualisieren“ → Run workflow*. Das Protokoll zeigt, was Claude gefunden und was die Prüfung verworfen hat.

## Auf dem Handy installieren

- **iPhone:** Seite in Safari öffnen → Teilen → *Zum Home-Bildschirm*.
- **Android:** Seite in Chrome öffnen → Menü → *App installieren*.

Auf installierten Apps zeigt das Symbol die Zahl neuer Einträge an (wo das System es unterstützt).

## Android-App (APK)

Zusätzlich zur Web-App gibt es eine native Android-App im Ordner `android/`. Sie bringt dieselbe Oberfläche mit und kann zusätzlich:

- **Benachrichtigungen** schicken, wenn ein neues Grounding oder eine neue Betriebseinschränkung auftaucht (einstellbar unter *Info → Benachrichtigungen*: Akut / Allem / Aus). Die App prüft etwa alle 3 Stunden im Hintergrund.
- **Offline starten** mit der letzten geladenen Datenlage.
- **Teilen** über das normale Android-Teilen-Menü (mit Link zur Quelle).

Die APK baut GitHub automatisch (Workflow „Android-App bauen“), sobald sich App-Code ändert, oder von Hand über *Actions → Android-App bauen → Run workflow*. Sie erscheint unter *Releases*; der Download-Link für die jeweils neueste Version lautet:

```
https://github.com/<dein-name>/<repo>/releases/latest/download/ejet-ops-watch.apk
```

Die Web-App zeigt diesen Link unter *Info* automatisch an.

**Einmalig einrichten:**

1. Die beiden Secrets aus der Datei `android-signaturschluessel.txt` anlegen (*Settings → Secrets and variables → Actions*): `ANDROID_KEYSTORE_BASE64` und `ANDROID_KEYSTORE_PASSWORD`. Ohne sie wird mit einem Test-Schlüssel signiert, und jedes Update muss neu installiert werden. Die Datei selbst **nicht** ins Repository hochladen.
2. GitHub Pages muss laufen (siehe oben), denn die App lädt ihre Daten von `https://<dein-name>.github.io/<repo>/data/issues.json`. Das Repository bzw. die Pages-Seite muss dafür öffentlich erreichbar sein.
3. *Actions → Android-App bauen → Run workflow*.

**Installieren:** Link auf dem Handy öffnen, APK herunterladen und antippen. Beim ersten Mal fragt Android, ob der Browser Apps installieren darf („Unbekannte Apps installieren“) – erlauben. Beim ersten Start fragt die App nach der Erlaubnis für Benachrichtigungen.

**Updates:** Neue APK-Version herunterladen und darüber installieren; Merkliste und Notizen bleiben erhalten.

**Play Store:** Für eine Veröffentlichung im Play Store brauchst du ein Google-Play-Entwicklerkonto (einmalig 25 USD) und ein App Bundle (`gradle bundleRelease` im Ordner `android`). Für den Eigengebrauch oder ein kleines Team reicht die APK.

## Einstellungen

| Was | Wo |
|---|---|
| Uhrzeit des Scans | `.github/workflows/update.yml`, Zeile `cron` (UTC). `30 4` und `30 15` = 06:30 und 17:30 Sommerzeit (Winterzeit eine Stunde früher) |
| KI-Modell | Repository-Variable `MODELS_MODEL` (Standard `openai/gpt-4.1-mini`, Ersatz `openai/gpt-4o-mini`) |

**Kosten:** Pro Lauf fallen bis zu 20 Websuchen (10 USD pro 1'000 Suchen) plus Tokens an, grob einige Rappen bis wenige Franken pro Tag je nach Modell. GitHub Actions und Pages sind für öffentliche Repositories gratis.

**Wichtig:** GitHub pausiert geplante Workflows, wenn ein Repository 60 Tage keine Aktivität hat. Die täglichen Daten-Commits zählen als Aktivität; falls tagelang nichts Neues kommt, erscheint auf GitHub ein Hinweis mit einem Knopf zum Reaktivieren.

## Einträge von Hand ändern

`data/issues.json` direkt auf GitHub bearbeiten und speichern. Die App wird automatisch neu veröffentlicht. Felder:

| Feld | Werte |
|---|---|
| `severity` | `grounding`, `limitation`, `inspection`, `watch` |
| `status` | `active`, `proposed`, `inforce`, `monitoring`, `resolved` |
| `family` | `["E1"]`, `["E2"]` oder beide |
| `date` | `YYYY-MM-DD` |
| `sources` | Liste von `{ "title": "...", "url": "https://..." }` |

## Lokal ausprobieren

```
python3 -m http.server 8080      # dann http://localhost:8080 öffnen
node scripts/selftest.mjs        # Prüflogik testen (ohne API)
GITHUB_TOKEN=… DRY_RUN=1 node scripts/collect.mjs   # Sammeln ohne zu speichern
```

Die Daten ersetzen nicht die verbindlichen ADs und Service Bulletins deines Betriebs.
