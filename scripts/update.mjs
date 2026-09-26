#!/usr/bin/env node
// Tägliche Aktualisierung: Claude sucht im Web nach neuen E1/E2-Problemen und
// liefert Änderungen als JSON. Das Skript prüft sie und schreibt data/issues.json.
//
// Umgebungsvariablen:
//   ANTHROPIC_API_KEY  (Pflicht)
//   CLAUDE_MODEL       (optional, Standard: claude-sonnet-5)
//   MAX_SEARCHES       (optional, Standard: 20)
//   DRY_RUN=1          (optional: nichts schreiben, nur anzeigen)
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyAnswer, collectSearchUrls, extractJson, zurichISO, SEVERITIES, STATUSES } from "./merge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data", "issues.json");
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const MAX_SEARCHES = Number(process.env.MAX_SEARCHES || 20);
const DRY = process.env.DRY_RUN === "1";

if (!API_KEY) { console.error("ANTHROPIC_API_KEY fehlt."); process.exit(1); }

const data = JSON.parse(await readFile(DATA, "utf8"));
const now = zurichISO();
const compact = data.issues.map(({ id, title, severity, status, family, date, ref, deadline, updated }) =>
  ({ id, title, severity, status, family, date, ref, deadline, updated }));

const system = `Du pflegst "E-Jet Ops Watch", einen Tracker für Probleme bei Embraer-Verkehrsflugzeugen, die zu Einschränkungen im Flugbetrieb führen können.
Im Umfang: E1 = E170, E175, E190, E195 (ERJ 170 / ERJ 190-100/-200, Triebwerke GE CF34-8E / CF34-10E) und E2 = E175-E2, E190-E2, E195-E2 (ERJ 190-300/-400, Triebwerk P&W PW1900G) inkl. Zulieferer-Systeme (z. B. Honeywell Primus Epic / Epic 2).
Nicht im Umfang: EMB-505 (Phenom), EMB-545/550 (Legacy/Praetor), EMB-135/145, EMB-120, Militär.

Vorgehen:
1. Suche gezielt nach Neuem seit dem letzten Scan: FAA-ADs und NPRMs (federalregister.gov), EASA-ADs (ad.easa.europa.eu), ANAC-ADs, Emergency ADs, Service Bulletins, Groundings/AOG, Zwischenfälle mit Systembezug, Dispatch-Probleme, Triebwerksthemen, Behördenmassnahmen. Nutze Fachpresse (FlightGlobal, Aviation Week, AeroInside, Aviation Herald, Simple Flying, aeroTELEGRAPH, Aeroin, Aviacionline, Air Data News, Reuters) auf Englisch, Deutsch, Portugiesisch und Spanisch.
2. Prüfe Folgemeldungen zu allen Einträgen mit Status active, proposed oder monitoring (z. B. Ursache, Software-Fix, AD, Final Rule zu einem NPRM, Aufhebung).
3. Nimm nur belegte Fakten auf. Jede Quelle muss eine URL sein, die in deinen Suchergebnissen vorkam. Unbestätigte Meldungen als "(Berichte)" kennzeichnen. Keine Dubletten zu bestehenden Einträgen – Neuigkeiten zu einem bestehenden Thema sind Updates.

Texte auf Deutsch (Schweizer Schreibweise, kein ß), sachlich, knapp.
severity: grounding = Flugzeuge am Boden / nicht dispatchbar; limitation = Betriebseinschränkung (Verfahren, AFM, MEL, Luftraum, Flottenverfügbarkeit); inspection = Inspektion/Wartung nach AD/SB; watch = beobachten, noch keine direkte Wirkung.
status: active = läuft akut; proposed = NPRM/Entwurf; inforce = AD in Kraft; monitoring = Lage wird beobachtet; resolved = behoben/aufgehoben.

Antworte am Ende AUSSCHLIESSLICH mit einem JSON-Codeblock in diesem Format:
\`\`\`json
{
  "new": [ { "id": "kebab-case-id", "title": "...", "family": ["E2"], "severity": "${SEVERITIES.join("|")}", "status": "${STATUSES.join("|")}",
             "date": "YYYY-MM-DD", "ref": "AD-/NPRM-/SB-Nummer oder Quellenart", "deadline": "optional", "system": "...", "models": "...",
             "summary": "2–3 Sätze", "impact": "operationelle Auswirkung", "operators": ["..."], "sources": [ { "title": "...", "url": "https://..." } ] } ],
  "updates": [ { "id": "bestehende-id", "fields": { "status": "...", "summary": "...", "impact": "...", "sources": [ { "title": "...", "url": "https://..." } ] } } ],
  "summary": "1–3 Sätze, was sich geändert hat"
}
\`\`\`
Bei updates nur geänderte Felder angeben; sources dort = neue Belege für die Änderung (Pflicht). Wenn nichts Neues: leere Listen.`;

const user = `Heute: ${now}. Letzter Scan: ${data.lastScan || "unbekannt"}.
Bestehende Einträge (Kurzform):
${JSON.stringify(compact, null, 1)}`;

async function call(messages) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 16000, system, messages,
        tools: [{ type: "web_search_20260318", name: "web_search", max_uses: MAX_SEARCHES }],
      }),
    });
    if (res.ok) return res.json();
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
    throw new Error(`API-Fehler ${res.status}: ${body.slice(0, 500)}`);
  }
}

const messages = [{ role: "user", content: user }];
const seen = new Set();
let msg, rounds = 0, searches = 0;
do {
  msg = await call(messages);
  collectSearchUrls(msg.content, seen);
  searches += msg.usage?.server_tool_use?.web_search_requests || 0;
  if (msg.stop_reason === "pause_turn") messages.push({ role: "assistant", content: msg.content });
} while (msg.stop_reason === "pause_turn" && ++rounds < 8);

const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
const answer = extractJson(text);
const result = applyAnswer(data, answer, seen, now);

const report = [
  `### E-Jet Ops Watch – Scan ${now}`,
  `Modell: ${MODEL} · Suchen: ${searches} · belegte URLs: ${seen.size}`,
  `Ergebnis: **${result.data.note}**`,
  answer.summary ? `\n${answer.summary}` : "",
  result.log.length ? `\nHinweise:\n${result.log.map((l) => `- ${l}`).join("\n")}` : "",
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");

if (DRY) { console.log("\nDRY_RUN – nichts geschrieben."); process.exit(0); }
await writeFile(DATA, JSON.stringify(result.data, null, 2) + "\n");
