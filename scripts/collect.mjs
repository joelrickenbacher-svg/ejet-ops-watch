#!/usr/bin/env node
// Tägliche Aktualisierung ohne Anthropic-API:
//   1. FAA-Dokumente (Federal Register) und Meldungen (Google-News-Feeds) sammeln
//   2. mit GitHub Models (kostenlos in Actions) auf Deutsch aufbereiten, sonst Regeln
//   3. prüfen und in data/issues.json einarbeiten
//
// Umgebungsvariablen:
//   GITHUB_TOKEN   (in Actions automatisch; ohne → nur Regeln)
//   MODELS_MODEL   (optional, z. B. openai/gpt-4.1-mini)
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
let processed = { urls: [] };
try { processed = JSON.parse(await readFile(PROCESSED, "utf8")); } catch { /* erster Lauf */ }
const done = new Set(processed.urls || []);
for (const it of data.issues) for (const s of it.sources || []) { const n = normUrl(s.url); if (n) done.add(n); }

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

const fresh = (c) => { const n = normUrl(c.url); return n && !done.has(n); };
const candidates = [
  ...faa.filter(fresh),
  ...news.filter(fresh).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 30),
];

// ---- 2. Aufbereiten
const token = process.env.GITHUB_TOKEN;
const models = [...new Set([process.env.MODELS_MODEL, "openai/gpt-4.1-mini", "openai/gpt-4o-mini"].filter(Boolean))];
const { answer, mode, log } = candidates.length
  ? await enrich(candidates, data.issues, { token, models })
  : { answer: { new: [], updates: [] }, mode: "–", log: [] };

// ---- 3. Einarbeiten (Quellen müssen aus den gesammelten Kandidaten stammen)
const known = new Set(candidates.map((c) => normUrl(c.url)).filter(Boolean));
const result = applyAnswer(data, answer, known, now);
result.data.note = `${result.data.note}${candidates.length ? ` · ${mode}` : ""}`;
result.data.lastRun = { at: now, faa: faa.length, news: news.length, candidates: candidates.length, mode, errors };

for (const c of candidates) { const n = normUrl(c.url); if (n) done.add(n); }
const nextProcessed = { urls: [...done].slice(-3000) };

// ---- Bericht
const report = [
  `### E-Jet Ops Watch – Lauf ${now}`,
  `FAA-Dokumente: ${faa.length} (seit ${faaSince}) · Meldungen: ${news.length} (${newsDays} Tage) · neu zu prüfen: ${candidates.length}`,
  `Aufbereitung: ${mode}`,
  `Ergebnis: **${result.data.note}**`,
  errors.length ? `\nQuellen-Fehler:\n${errors.map((e) => `- ${e}`).join("\n")}` : "",
  [...log, ...result.log].length ? `\nHinweise:\n${[...log, ...result.log].map((l) => `- ${l}`).join("\n")}` : "",
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");

if (DRY) { console.log("\nDRY_RUN – nichts geschrieben."); process.exit(0); }
await writeFile(DATA, JSON.stringify(result.data, null, 2) + "\n");
await writeFile(PROCESSED, JSON.stringify(nextProcessed) + "\n");
