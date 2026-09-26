# E-Jet Ops Watch – GitHub neu aufsetzen

Diese Anleitung nutzt **GitHub Desktop**, weil der Upload im Browser den versteckten Ordner `.github` (die Automatik) weglässt.

Du brauchst:
- dieses entpackte Paket
- `android-signaturschluessel.txt` (separat geschickt, NICHT ins Repository)
- einen Anthropic-API-Schlüssel (console.anthropic.com → API Keys → Create Key, Guthaben unter Billing)

## 1. Altes Repository löschen
github.com/joelrickenbacher-svg/ejet-ops-watch → Settings → ganz unten „Delete this repository“ → Bestätigungen durchklicken.

## 2. Neues Repository erstellen
github.com/new → Name `ejet-ops-watch` → **Public** → README/.gitignore/License aus → Create repository.

## 3. Secrets anlegen
Settings → Secrets and variables → Actions → New repository secret, dreimal:
- `ANTHROPIC_API_KEY` = API-Schlüssel
- `ANDROID_KEYSTORE_PASSWORD` = Passwort aus der TXT-Datei
- `ANDROID_KEYSTORE_BASE64` = lange Zeile aus der TXT-Datei

## 4. GitHub Desktop installieren
desktop.github.com → herunterladen, installieren, mit dem GitHub-Konto anmelden.

## 5. Repository auf den PC holen
Auf der Seite des neuen Repositorys: „Set up in Desktop“ → GitHub Desktop öffnet sich → Local path merken (z. B. Dokumente\GitHub) → Clone.

## 6. Dateien hineinkopieren
GitHub Desktop → Repository → Show in Explorer. Im entpackten Paket alles markieren (Strg+A), kopieren, im geöffneten Ordner einfügen. Danach liegen `.github`, `android`, `data`, `icons`, `scripts`, `index.html` … direkt in diesem Ordner (nicht in einem Unterordner).

## 7. Hochladen
GitHub Desktop: links stehen rund 80 Dateien, darunter `.github/workflows/android.yml`. Unten Summary „Erste Version“ → Commit to main → oben Publish branch bzw. Push origin.

## 8. Pages einschalten
Settings → Pages → Source: GitHub Actions. Dann Actions → „App veröffentlichen“ → Run workflow.

## 9. Erste Läufe
Actions → „Daten aktualisieren“ → Run workflow. „Android-App bauen“ läuft nach dem Push von selbst (sonst Run workflow).

## 10. Prüfen
- Web-App: https://joelrickenbacher-svg.github.io/ejet-ops-watch/
- APK: https://github.com/joelrickenbacher-svg/ejet-ops-watch/releases/latest/download/ejet-ops-watch.apk
