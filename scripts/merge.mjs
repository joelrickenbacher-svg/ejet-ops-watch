// Reine Logik (ohne Netz): Antwort von Claude prüfen und in die Daten einarbeiten.
export const SEVERITIES = ["grounding", "limitation", "inspection", "watch"];
export const STATUSES = ["active", "proposed", "inforce", "monitoring", "resolved"];
export const FAMILIES = ["E1", "E2"];
const TEXT_FIELDS = ["title", "summary", "impact", "models", "system", "ref", "deadline", "latest"];
const UPDATABLE = [...TEXT_FIELDS, "severity", "status", "family", "date", "operators", "sources"];

/** ISO-Zeitstempel in Europe/Zurich, z. B. 2026-09-25T06:31:00+02:00 */
export function zurichISO(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const off = (parts.timeZoneName || "GMT+00:00").replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off === "" ? "+00:00" : off}`;
}

export function normUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" && x.protocol !== "http:") return null;
    x.hash = "";
    let s = (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/+$/, "").toLowerCase();
    if (x.search && !/^\?(utm_|ref=)/.test(x.search)) s += x.search.toLowerCase();
    return s;
  } catch { return null; }
}

/** Sammelt alle URLs aus web_search-Ergebnissen, auch verschachtelt (dynamisches Filtern). */
export function collectSearchUrls(node, out = new Set()) {
  if (Array.isArray(node)) { node.forEach((n) => collectSearchUrls(n, out)); return out; }
  if (node && typeof node === "object") {
    if ((node.type === "web_search_result" || node.type === "web_search_result_location" || node.type === "web_fetch_result") && node.url) {
      const n = normUrl(node.url); if (n) out.add(n);
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") collectSearchUrls(v, out);
  }
  return out;
}

/** Zieht das JSON-Objekt aus der Schlussantwort (```json … ``` oder letztes {...}). */
export function extractJson(text) {
  const fence = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]).pop();
  const candidates = [fence, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)].filter(Boolean);
  for (const c of candidates) { try { return JSON.parse(c); } catch { /* weiter */ } }
  throw new Error("Keine gültige JSON-Antwort gefunden");
}

const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
const str = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

function cleanSources(list, known, log, ctx) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const url = typeof s === "string" ? s : s?.url;
    const n = normUrl(url);
    if (!n) { log.push(`${ctx}: ungültige Quelle verworfen (${url})`); continue; }
    if (known && !known.has(n)) { log.push(`${ctx}: Quelle nicht in Suchergebnissen, verworfen (${url})`); continue; }
    const src = { title: str(s?.title, 200) || new URL(url).hostname, url };
    if (typeof s?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) src.date = s.date;
    out.push(src);
  }
  return out;
}

function cleanFields(src, log, ctx) {
  const f = {};
  for (const k of TEXT_FIELDS) { const v = str(src[k]); if (v !== undefined && v !== "") f[k] = v; }
  if (src.severity !== undefined) { if (SEVERITIES.includes(src.severity)) f.severity = src.severity; else log.push(`${ctx}: severity "${src.severity}" ungültig`); }
  if (src.status !== undefined) { if (STATUSES.includes(src.status)) f.status = src.status; else log.push(`${ctx}: status "${src.status}" ungültig`); }
  if (src.family !== undefined) { const fam = [...new Set((Array.isArray(src.family) ? src.family : [src.family]).filter((x) => FAMILIES.includes(x)))]; if (fam.length) f.family = fam; }
  if (src.date !== undefined) { if (isDate(src.date)) f.date = src.date; else log.push(`${ctx}: Datum "${src.date}" ungültig`); }
  if (src.operators !== undefined && Array.isArray(src.operators)) f.operators = src.operators.map((o) => str(o, 120)).filter(Boolean).slice(0, 30);
  return f;
}

/**
 * Arbeitet die Antwort ein. `answer` = { new: [...], updates: [{id, fields}], summary }
 * `knownUrls` = Set normalisierter URLs aus den Suchergebnissen (null = nicht prüfen).
 * Gibt { data, added, updated, log } zurück. Löscht nie Einträge.
 */
export function applyAnswer(data, answer, knownUrls, now = zurichISO()) {
  const log = [];
  const issues = structuredClone(data.issues || []);
  const ids = new Set(issues.map((i) => i.id));
  let added = 0, updated = 0;

  for (const raw of Array.isArray(answer?.new) ? answer.new : []) {
    const ctx = `neu "${raw?.title || "?"}"`;
    const f = cleanFields(raw || {}, log, ctx);
    const sources = cleanSources(raw?.sources, knownUrls, log, ctx);
    const missing = ["title", "summary", "impact", "severity", "status", "family", "date"].filter((k) => !f[k]);
    if (missing.length) { log.push(`${ctx}: verworfen, fehlt ${missing.join(", ")}`); continue; }
    if (!sources.length) { log.push(`${ctx}: verworfen, keine belegte Quelle`); continue; }
    let id = slug(raw.id) || slug(f.title);
    if (!id) { log.push(`${ctx}: verworfen, keine ID`); continue; }
    if (ids.has(id)) { log.push(`${ctx}: ID ${id} existiert schon, als neu ignoriert`); continue; }
    ids.add(id);
    issues.push({ id, ...f, operators: f.operators || [], sources, updated: now });
    added++;
  }

  for (const u of Array.isArray(answer?.updates) ? answer.updates : []) {
    const it = issues.find((i) => i.id === u?.id);
    const ctx = `update ${u?.id}`;
    if (!it) { log.push(`${ctx}: unbekannte ID, ignoriert`); continue; }
    const src = Object.fromEntries(Object.entries(u.fields || {}).filter(([k]) => UPDATABLE.includes(k)));
    const f = cleanFields(src, log, ctx);
    const newSources = cleanSources(u.fields?.sources ?? u.add_sources, knownUrls, log, ctx);
    // Jede Änderung braucht mindestens eine Quelle, die Claude in dieser Suche tatsächlich gesehen hat.
    if (knownUrls && !newSources.length) { log.push(`${ctx}: verworfen, keine belegte Quelle für die Änderung`); continue; }
    let changed = false;
    for (const [k, v] of Object.entries(f)) {
      if (JSON.stringify(it[k]) !== JSON.stringify(v)) { it[k] = v; changed = true; }
    }
    if (newSources.length) {
      const have = new Set((it.sources || []).map((s) => normUrl(s.url)));
      const fresh = newSources.filter((s) => !have.has(normUrl(s.url)));
      if (fresh.length) { it.sources = [...(it.sources || []), ...fresh]; changed = true; }
    }
    if (changed) { it.updated = now; updated++; }
  }

  const note = added || updated ? `${added} neu, ${updated} aktualisiert` : "Keine Änderungen";
  return { data: { ...data, schema: 1, lastScan: now, note, issues }, added, updated, log };
}
