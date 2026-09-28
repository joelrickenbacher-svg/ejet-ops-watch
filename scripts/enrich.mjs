// Aufbereitung der Kandidaten: deutsche Texte und Einstufung per Google Gemini (Gratis-Stufe),
// sonst einfache Regeln. Ergebnis ist eine "Antwort" im Format von merge.mjs ({ new, updates }).
import { extractJson } from "./merge.mjs";
import { familyOf } from "./sources.mjs";

const SEVERITIES = ["grounding", "limitation", "inspection", "watch"];
const STATUSES = ["active", "proposed", "inforce", "monitoring", "resolved"];

const SYSTEM = `Du pflegst "E-Jet Ops Watch", einen Tracker für Probleme bei Embraer-Verkehrsflugzeugen, die den Flugbetrieb einschränken können.
Im Umfang: E1 = E170/E175/E190/E195 (ERJ 170, ERJ 190-100/-200, Triebwerke GE CF34-8E/-10E) und E2 = E190-E2/E195-E2 (ERJ 190-300/-400, Triebwerk P&W PW1900G), inkl. Zulieferer-Systeme (z. B. Honeywell Primus Epic 2).
Nicht im Umfang: Phenom, Praetor/Legacy, EMB-135/145, EMB-120, Militär, reine Geschäftsmeldungen (Bestellungen, Auslieferungen, Routen).

Du bekommst nummerierte Kandidaten (FAA-Dokumente oder Nachrichten) und die Liste bestehender Einträge.
Entscheide pro Kandidat:
- "ignore": nicht im Umfang, kein betriebsrelevantes Problem, oder nichts Neues gegenüber einem bestehenden Eintrag.
- "update": neue Information zu einem bestehenden Eintrag (target = dessen id), z. B. Ursache gefunden, Fix, AD erlassen, Problem behoben.
- "new": neues, eigenständiges Problem.
Wichtig: Meldungen zur URSACHE, Lösung oder Aufhebung eines bestehenden Problems sind "update" des bestehenden Eintrags, auch wenn die Meldung andere Flugzeugtypen mitnennt (z. B. Ursache einer GPS-Störung gefunden). In summary dann den neuen Gesamtstand in 2–4 Sätzen beschreiben (bisher Bekanntes kurz behalten, Neues ergänzen, Quelle nennen, z. B. "laut Aeroin").
Benutze nur Fakten aus dem Kandidaten. Nichts erfinden. Unbestätigte Meldungen als "(Berichte)" kennzeichnen.
Texte auf Deutsch (Schweizer Schreibweise, kein ß), sachlich, knapp.
severity: grounding = Flugzeuge am Boden/nicht dispatchbar; limitation = Betriebseinschränkung (Verfahren, AFM, MEL, Luftraum, Verfügbarkeit); inspection = Inspektion/Wartung nach AD/SB; watch = beobachten.
status: active = läuft akut; proposed = NPRM/Entwurf; inforce = AD in Kraft; monitoring = Lage wird beobachtet; resolved = behoben.

Antworte NUR mit JSON:
{"items":[{"i":0,"action":"new|update|ignore","target":"","title":"","summary":"2–3 Sätze","impact":"operationelle Auswirkung","severity":"","status":"","family":["E1"|"E2"],"models":"","system":"","ref":"","date":"YYYY-MM-DD"}]}
Bei "update" nur die Felder füllen, die sich ändern (mindestens summary oder status). Bei "ignore" nur i und action.`;

function describe(c, i) {
  const lines = [`#${i} [${c.kind === "faa" ? `FAA ${c.type}` : `News${c.source ? " · " + c.source : ""}`}] ${c.date}`, `Titel: ${c.title}`];
  if (c.kind === "faa") {
    lines.push(`Dokument: FR ${c.docNumber}${c.dockets?.length ? " · " + c.dockets.join(", ") : ""}`);
    lines.push(`Zusammenfassung: ${String(c.abstract).slice(0, 700)}`);
  } else if (c.snippet) {
    lines.push(`Anriss: ${c.snippet}`);
  }
  return lines.join("\n");
}

async function callModel(endpoint, model, token, user) {
  let lowThinking = true; // Gemini "denkt" sonst viel und braucht das Token-Budget auf
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 8000,
        ...(lowThinking ? { reasoning_effort: "low" } : {}),
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const content = j.choices?.[0]?.message?.content || "";
      if (!content.trim()) throw new Error(`${model}: leere Antwort (${j.choices?.[0]?.finish_reason || "?"})`);
      return content;
    }
    const raw = await res.text();
    let body = raw.slice(0, 300);
    try { const j = JSON.parse(raw); body = (Array.isArray(j) ? j[0] : j)?.error?.message || body; } catch { /* Rohtext */ }
    if (res.status === 400 && lowThinking && /reasoning/i.test(body)) { lowThinking = false; continue; }
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 30_000)); continue; }
    if (res.status === 503 && attempt < 2) { await new Promise((r) => setTimeout(r, 15_000)); continue; }
    throw new Error(`${model}: HTTP ${res.status} ${body}`);
  }
  throw new Error(`${model}: Limit erreicht`);
}

const clean = (v, max = 1500) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

// ---------------------------------------------------------------- Regeln (Fallback)

export function heuristicFaa(c) {
  const text = `${c.title} ${c.abstract}`;
  const proposed = /proposed/i.test(c.type);
  const prompted = (c.abstract.match(/prompted by ([^.]+)\./i) || [])[1];
  const models = (c.abstract.match(/Model[s]?\s+([^.]*?)\s+(airplanes|engines)/i) || [])[1];
  const limitation = /(flight manual|AFM|limitation|prohibit|operational)/i.test(c.abstract);
  const fam = familyOf(text);
  return {
    title: `FAA ${proposed ? "NPRM" : "AD"}: ${(prompted ? prompted.charAt(0).toUpperCase() + prompted.slice(1) : c.title).slice(0, 120)}`,
    summary: `${String(c.abstract).slice(0, 600)} (Originaltext der FAA, automatisch erfasst.)`,
    impact: proposed
      ? "Vorgeschlagene Lufttüchtigkeitsanweisung. Anforderungen und Fristen gemäss Text; verbindlich erst nach Inkrafttreten."
      : "Verbindliche Lufttüchtigkeitsanweisung. Massnahmen und Fristen gemäss AD-Text.",
    severity: limitation ? "limitation" : "inspection",
    status: proposed ? "proposed" : "inforce",
    family: fam.length ? fam : ["E1", "E2"],
    models: models ? models.slice(0, 200) : "siehe Dokument",
    system: "siehe Dokument",
    ref: `FAA ${proposed ? "NPRM" : "Final Rule"} · FR ${c.docNumber}${c.dockets?.length ? " · " + c.dockets.join(", ") : ""}`,
    date: c.date,
  };
}

const GROUNDING_NEWS = /(grounded|grounding|AOG|aircraft on ground|am Boden|gegroundet|no solo|em solo|en tierra|parad[oa]s|emergency directive|emergency AD)/i;

// Themen-Wörterbuch: verbindet Meldungen mit bestehenden Einträgen
const TOPICS = {
  gps: /\b(GPS|GNSS|NTS-?3|satellit|satélite|satelite|Primus Epic|navigation)/i,
  gtf: /(PW1900G|PW1000G|GTF|geared turbofan|Pratt|combustor|Brennkammer|powder metal|Pulvermetall)/i,
  cf34: /(CF34|FADEC|EEC)/i,
  hpc: /(\bHPC\b|compressor|Verdichter|stator|bushing)/i,
  flightctl: /(aileron|Querruder|flap|backlash|flutter|flight control|Flugsteuerung)/i,
  brakes: /(brak|Bremse|MAU\b|modular avionics)/i,
  radalt: /(radio altimeter|radar altimeter|Radio-Altimeter|5G|C-band|C-Band)/i,
  gear: /(landing gear|Fahrwerk|MLG|NLG|trem de pouso)/i,
  pylon: /(pylon|engine mount|Triebwerksaufhängung)/i,
  bleed: /(overheat|bleed|ODS\b|Überhitz)/i,
  perf: /(takeoff calculation|CAFM|flight manual|Startberechnung)/i,
};
const topicsOf = (t) => Object.entries(TOPICS).filter(([, re]) => re.test(t || "")).map(([k]) => k);
const fmtDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? `${d.slice(8, 10)}.${d.slice(5, 7)}.` : "");

/** Ordnet eine Meldung einem offenen Eintrag zu (gleiches Thema, passende Familie). */
export function matchIssue(c, issues) {
  const ct = topicsOf(`${c.title} ${c.snippet || ""}`);
  if (!ct.length) return null;
  const cf = familyOf(`${c.title} ${c.snippet || ""}`);
  let best = null, bestScore = 0;
  for (const it of issues) {
    if (it.status === "resolved") continue;
    const it_t = topicsOf(`${it.title} ${it.system || ""} ${it.models || ""}`);
    const shared = ct.filter((t) => it_t.includes(t)).length;
    if (!shared) continue;
    if (cf.length && it.family?.length && !cf.some((f) => it.family.includes(f))) continue;
    // aktive Einträge bevorzugen, dann neuere
    const score = shared * 10 + (it.status === "active" ? 5 : it.status === "monitoring" ? 3 : 0) + (String(it.date) > "2026" ? 1 : 0);
    if (score > bestScore) { best = it; bestScore = score; }
  }
  return best;
}

export function heuristicNews(c) {
  const fam = familyOf(`${c.title} ${c.snippet}`);
  return {
    title: `Meldung: ${c.title}`.slice(0, 160),
    summary: `${c.source ? c.source + ": " : ""}${c.snippet || c.title} (Automatisch erfasst, nicht ausgewertet – Originalquelle prüfen.)`,
    impact: "Mögliche Einschränkung laut Medienbericht (Berichte). Details in der Quelle.",
    severity: "watch",
    status: "monitoring",
    family: fam.length ? fam : ["E1", "E2"],
    models: "siehe Quelle",
    system: "siehe Quelle",
    ref: `Medienbericht${c.source ? " · " + c.source : ""}`,
    date: c.date,
  };
}

// ---------------------------------------------------------------- Hauptfunktion

/**
 * @returns {Promise<{answer:{new:any[],updates:any[]}, mode:string, log:string[]}>}
 */
export async function enrich(candidates, issues, { token, models = [], endpoint = "" } = {}) {
  const log = [];
  const answer = { new: [], updates: [] };
  const srcOf = (c) => [{ title: `${c.kind === "faa" ? "Federal Register" : c.source || "Meldung"} – ${c.title}`.slice(0, 200), url: c.url, date: c.date }];

  // 1) FAA Final Rule zu einem bestehenden NPRM (gleiches Docket) → Status "in Kraft"
  const rest = [];
  for (const c of candidates) {
    if (c.kind === "faa" && !/proposed/i.test(c.type) && c.dockets?.length) {
      const hit = issues.find((it) => c.dockets.some((d) => String(it.ref || "").includes(d)));
      if (hit) {
        answer.updates.push({ id: hit.id, fields: { status: "inforce", ref: `${hit.ref} · Final Rule FR ${c.docNumber}`, sources: srcOf(c) } });
        log.push(`Final Rule ${c.docNumber} → ${hit.id} in Kraft`);
        continue;
      }
    }
    rest.push(c);
  }

  // 2) KI-Aufbereitung in kleinen Paketen (Limits von GitHub Models: ~8k Token Eingabe)
  // Stand der Einträge; wird nach jedem Paket mit den KI-Updates nachgeführt, damit spätere
  // Meldungen auf dem neuen Stand aufbauen (und z. B. eine gefundene Ursache nicht wieder verloren geht).
  const state = new Map(issues.map((i) => [i.id, { ...i }]));
  const existingText = () => [...state.values()].filter((i) => i.status !== "resolved")
    .map((i) => `${i.id} | ${i.title} | ${i.status}${i.ref ? " | " + String(i.ref).slice(0, 80) : ""}\n   Stand: ${String(i.summary || "").slice(0, 600)}`).join("\n");
  const decided = new Map(); // Kandidat → Entscheidung
  let aiOk = 0, aiFail = 0;
  const order = [...models];
  if (token && endpoint && models.length && rest.length) {
    for (let start = 0; start < rest.length; start += 6) {
      const batch = rest.slice(start, start + 6);
      const user = `Bestehende Einträge (id | Titel | Status | Referenz, darunter der bisherige Stand):\n${existingText()}\n\nKandidaten:\n\n${batch.map((c, k) => describe(c, k)).join("\n\n")}`;
      let parsed = null;
      for (const model of [...order]) {
        try {
          const p = extractJson(await callModel(endpoint, model, token, user));
          if (!Array.isArray(p?.items)) throw new Error(`${model}: Antwort ohne "items"`);
          parsed = p; break;
        } catch (e) {
          log.push(`KI nicht verfügbar: ${String(e.message).slice(0, 200)}`);
          order.push(order.splice(order.indexOf(model), 1)[0]); // überlastetes Modell ans Ende
        }
      }
      if (!parsed) { aiFail += batch.length; continue; }
      for (const it of parsed.items) {
        const c = batch[Number(it.i)];
        if (!c) continue;
        decided.set(c, it);
        const st = it.action === "update" && state.get(it.target);
        if (st) {
          if (clean(it.summary)) st.summary = clean(it.summary);
          if (STATUSES.includes(it.status)) st.status = it.status;
        }
      }
      for (const c of batch) {
        const d = decided.get(c);
        if (d) log.push(`KI: ${d.action}${d.action === "update" ? " → " + d.target : ""} · ${String(c.title).slice(0, 90)}`);
      }
      aiOk += batch.length;
    }
  }

  // 3) Entscheidungen umsetzen, sonst Regeln
  let fallbackNews = 0;
  const linked = {};
  const aiUpd = {};
  for (const c of rest) {
    const d = decided.get(c);
    if (d && d.action === "update" && issues.some((i) => i.id === d.target)) {
      const u = (aiUpd[d.target] ||= { fields: { sources: [] }, heads: [] });
      u.fields.sources.push(...srcOf(c));
      u.heads.push(c);
      // spätere Pakete kennen den neueren Stand → ihre Texte gewinnen
      for (const k of ["summary", "impact", "ref"]) if (clean(d[k])) u.fields[k] = clean(d[k]);
      if (SEVERITIES.includes(d.severity)) u.fields.severity = d.severity;
      if (STATUSES.includes(d.status)) u.fields.status = d.status;
      continue;
    }
    if (d && d.action === "new") {
      const f = {
        title: clean(d.title, 160), summary: clean(d.summary), impact: clean(d.impact),
        severity: d.severity, status: d.status,
        family: Array.isArray(d.family) && d.family.length ? d.family : familyOf(`${c.title} ${c.snippet || c.abstract || ""}`),
        models: clean(d.models, 200) || "siehe Quelle", system: clean(d.system, 200) || "siehe Quelle",
        ref: clean(d.ref, 200) || (c.kind === "faa" ? `FR ${c.docNumber}` : `Medienbericht${c.source ? " · " + c.source : ""}`),
        date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : c.date,
      };
      answer.new.push({ ...f, operators: [], sources: srcOf(c) });
      continue;
    }
    if (d && d.action === "ignore" && c.kind === "news") continue;
    // Keine (brauchbare) KI-Entscheidung, oder FAA-Dokument von der KI ignoriert → Regeln
    if (c.kind === "faa") {
      if (d && d.action === "ignore") { log.push(`FAA ${c.docNumber} von KI als nicht relevant eingestuft`); continue; }
      answer.new.push({ ...heuristicFaa(c), operators: [], sources: srcOf(c) });
    } else if (!d) {
      const hit = matchIssue(c, issues);
      if (hit) {
        (linked[hit.id] ||= []).push(c);
      } else if (GROUNDING_NEWS.test(c.title) && fallbackNews < 2) {
        answer.new.push({ ...heuristicNews(c), operators: [], sources: srcOf(c) });
        fallbackNews++;
      }
    }
  }
  // Schlagzeile für "Neu:" – Ursache/Lösung vor allem anderen, dann die neueste
  const KEY = /(ursache|grund|causa|causad|cause|caused|blamed|satellit|satélite|fix|behoben|gelöst|solução|resolvid|resolved|solved|software|directive|AD\b|diretriz)/i;
  const byImportance = (a, b) => (KEY.test(b.title) - KEY.test(a.title)) || String(b.date).localeCompare(String(a.date));
  const headline = (c) => `${fmtDay(c.date)} ${c.source ? c.source + ": " : ""}${c.title}`.trim();

  for (const [id, u] of Object.entries(aiUpd)) {
    u.heads.sort(byImportance);
    answer.updates.push({ id, fields: { ...u.fields, latest: headline(u.heads[0]) } });
  }
  // Regel-Zuordnungen: bis zu 3 Quellen; "Neu:" nur setzen, wenn die KI den Eintrag nicht schon bearbeitet hat
  for (const [id, list] of Object.entries(linked)) {
    list.sort(byImportance);
    const fields = { sources: list.slice(0, 3).flatMap(srcOf) };
    if (!aiUpd[id]) fields.latest = headline(list[0]);
    answer.updates.push({ id, fields });
    log.push(`${list.length} Meldung(en) per Regeln → ${id}`);
  }

  const mode = !token ? "Regeln" : aiFail === 0 ? "KI" : aiOk === 0 ? "Regeln (KI nicht verfügbar)" : "KI teilweise";
  return { answer, mode, log, aiSeen: new Set(decided.keys()) };
}
