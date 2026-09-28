#!/usr/bin/env node
// Tägliche Aktualisierung ohne Anthropic-API:
//   1. FAA-Dokumente (Federal Register) und Meldungen (Google-News-Feeds) sammeln
//   2. mit Gemini auf Deutsch aufbereiten (falls Schlüssel vorhanden), sonst per Regeln zuordnen
//   3. prüfen und in data/issues.json einarbeiten
//
// Umgebungsvariablen:
//   GEMINI_API_KEY (optional, gratis bei Google AI Studio) oder AI_TOKEN + AI_ENDPOINT; AI_MODEL optional
//   DRY_RUN=1      (optional: nichts schreiben)
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyAnswer, normUrl, zurichISO } from "./merge.mjs";
import { fetchFederalRegister, fetchNews } from "./sources.mjs";
import { enrich } from "./enrich.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data", "issues.json");
const PROCESSED = join(ROOT, "data", "processed.json");
const DRY = process.env.DRY_RUN === "1";

const data = JSON.parse(await readFile(DATA, "utf8"));
// processed.urls = fertig ausgewertete Quellen (FAA oder von der KI beurteilt).
// Meldungen, die nur per Regeln zugeordnet wurden, gelten NICHT als fertig: sobald die KI läuft,
// werden sie (solange sie im Suchfenster liegen) nochmals von der KI beurteilt.
let processed = { v: 5, urls: [] };
try { processed = JSON.parse(await readFile(PROCESSED, "utf8")); } catch { /* erster Lauf */ }
if (processed.v !== 5) processed = { v: 5, urls: [] }; // ältere Listen: einmalig alles im Suchfenster neu beurteilen
const done = new Set(processed.urls || []);
// FAA-Dokumente, die schon als Quelle in einem Eintrag stehen, nicht nochmals anlegen
for (const it of data.issues) for (const s of it.sources || []) {
  const n = normUrl(s.url); if (n && n.startsWith("federalregister.gov/")) done.add(n);
}

const now = zurichISO();
const day = (d) => d.toISOString().slice(0, 10);
// Immer ein festes Fenster; bereits Verarbeitetes filtert data/processed.json heraus.
const faaSince = day(new Date(Date.now() - 30 * 864e5));
const newsDays = Number(process.env.NEWS_DAYS || 7);

// ---- 1. Sammeln
const errors = [];
let faa = [], news = [];
try { faa = await fetchFederalRegister(faaSince); } catch (e) { errors.push(`Federal Register: ${e.message}`); }
try { news = await fetchNews(newsDays); } catch (e) { errors.push(`News: ${e.message}`); }
if (errors.length === 2) { console.error(errors.join("\n")); process.exit(1); }

const KEYNEWS = /(ursache|causa|causad|cause|caused|blamed|satellit|satélite|fix|behoben|solução|resolvid|resolved|solved|directive|diretriz)/i;
const fresh = (c) => { const n = normUrl(c.url); return n && !done.has(n); };
const candidates = [
  ...faa.filter(fresh),
  // Meldungen zu Ursache/Lösung zuerst, dann die neuesten (max. 30 pro Lauf)
  ...news.filter(fresh).sort((a, b) => (KEYNEWS.test(b.title) - KEYNEWS.test(a.title)) || String(b.date).localeCompare(String(a.date))).slice(0, 30),
];

// ---- 2. Aufbereiten
// KI (optional): Google Gemini (GEMINI_API_KEY, gratis Stufe) oder ein anderer OpenAI-kompatibler Dienst
// (AI_TOKEN + AI_ENDPOINT). Ohne Schlüssel → nur Regeln.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";
const token = process.env.GEMINI_API_KEY || process.env.AI_TOKEN || "";
const base = (process.env.AI_ENDPOINT || (process.env.GEMINI_API_KEY ? GEMINI : "")).replace(/\/chat\/completions$/, "").replace(/\/+$/, "");
const endpoint = base ? base + "/chat/completions" : "";

/** Wählt verfügbare Text-Modelle (Flash bevorzugt, neueste zuerst). */
async function pickModels() {
  if (process.env.AI_MODEL) return [process.env.AI_MODEL];
  if (!token || !base) return [];
  try {
    const res = await fetch(base + "/models", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ids = ((await res.json()).data || []).map((m) => String(m.id).replace(/^models\//, ""));
    const text = ids.filter((id) => /gemini/i.test(id) && /flash/i.test(id) && !/(tts|live|image|transcribe|embed|audio|vision|omni)/i.test(id));
    const ver = (id) => Number((id.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    text.sort((a, b) => (/preview|exp/.test(a) - /preview|exp/.test(b)) || (/lite/.test(a) - /lite/.test(b)) || ver(b) - ver(a));
    if (!text.length) throw new Error("keine Flash-Modelle gefunden");
    // die zwei neuesten Flash-Modelle, dazu ein Lite-Modell als Ausweichmöglichkeit bei Überlastung
    const full = text.filter((id) => !/lite/.test(id)).slice(0, 2);
    const lite = text.find((id) => /lite/.test(id));
    return [...new Set([...full, lite, ...text])].filter(Boolean).slice(0, 3);
  } catch (e) {
    console.warn(`Modell-Liste nicht abrufbar (${e.message}) – nehme Standard.`);
    return ["gemini-3.5-flash", "gemini-3.5-flash-lite"];
  }
}
const models = await pickModels();

const { answer, mode, log, aiSeen } = candidates.length
  ? await enrich(candidates, data.issues, { token, models, endpoint })
  : { answer: { new: [], updates: [] }, mode: "–", log: [], aiSeen: new Set() };

// ---- 3. Einarbeiten (Quellen müssen aus den gesammelten Kandidaten stammen)
const known = new Set(candidates.map((c) => normUrl(c.url)).filter(Boolean));
const result = applyAnswer(data, answer, known, now);
if (mode !== "Regeln" && candidates.length) result.data.note = `${result.data.note} · ${mode}`;
result.data.lastRun = { at: now, faa: faa.length, news: news.length, candidates: candidates.length, mode, errors };

// Als erledigt merken: FAA immer; Meldungen nur, wenn die KI sie beurteilt hat
// (ohne KI werden Meldungen beim nächsten Lauf nochmals geprüft, solange sie im Suchfenster liegen).
let deferred = 0;
for (const c of candidates) {
  const n = normUrl(c.url); if (!n) continue;
  if (c.kind === "faa" || aiSeen.has(c)) done.add(n); else deferred++;
}
const nextProcessed = { v: 5, urls: [...done].slice(-3000) };

// ---- Bericht
const report = [
  `### E-Jet Ops Watch – Lauf ${now}`,
  `FAA-Dokumente: ${faa.length} (seit ${faaSince}) · Meldungen: ${news.length} (${newsDays} Tage) · neu zu prüfen: ${candidates.length}`,
  `Aufbereitung: ${mode}${models.length ? ` (${models.join(", ")})` : ""}`,
  `Ergebnis: **${result.data.note}**`,
  deferred ? `${deferred} Meldung(en) nur per Regeln zugeordnet – werden beim nächsten Lauf mit KI nochmals geprüft.` : "",
  errors.length ? `\nQuellen-Fehler:\n${errors.map((e) => `- ${e}`).join("\n")}` : "",
  [...log, ...result.log].length ? `\nHinweise:\n${[...log, ...result.log].map((l) => `- ${l}`).join("\n")}` : "",
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");

if (DRY) { console.log("\nDRY_RUN – nichts geschrieben."); process.exit(0); }
await writeFile(DATA, JSON.stringify(result.data, null, 2) + "\n");
await writeFile(PROCESSED, JSON.stringify(nextProcessed) + "\n");
