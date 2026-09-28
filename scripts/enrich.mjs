// Aufbereitung der Kandidaten: deutsche Texte und Einstufung per GitHub Models (kostenlos in Actions),
// sonst einfache Regeln. Ergebnis ist eine "Antwort" im Format von merge.mjs ({ new, updates }).
import { extractJson } from "./merge.mjs";
import { familyOf } from "./sources.mjs";

const ENDPOINT = "https://models.github.ai/inference/chat/completions";
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
Wichtig: Meldungen zur URSACHE, Lösung oder Aufhebung eines bestehenden Problems sind "update" des bestehenden Eintrags, auch wenn die Meldung andere Flugzeugtypen mitnennt (z. B. Ursache einer GPS-Störung gefunden). In summary dann den neuen Stand beschreiben.
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

async function callModel(model, token, user) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 3000,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }),
    });
    if (res.ok) {
      const j = await res.json();
      return j.choices?.[0]?.message?.content || "";
    }
    const body = (await res.text()).slice(0, 300);
    if (res.status === 429 && attempt === 1) { await new Promise((r) => setTimeout(r, 30_000)); continue; }
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

const GROUNDING_NEWS = /(grounded|grounding|AOG|aircraft on ground|am Boden|gegroundet|no solo|em solo|en tierra|parad[oa]s)/i;

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
export async function enrich(candidates, issues, { token, models = [] } = {}) {
  const log = [];
  const answer = { new: [], updates: [] };
  const srcOf = (c) => [{ title: `${c.kind === "faa" ? "Federal Register" : c.source || "Meldung"} – ${c.title}`.slice(0, 200), url: c.url }];

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
  const existing = issues.filter((i) => i.status !== "resolved")
    .map((i) => `${i.id} | ${i.title} | ${i.status}${i.ref ? " | " + String(i.ref).slice(0, 80) : ""}`).join("\n");
  const decided = new Map(); // Kandidat → Entscheidung
  let aiOk = 0, aiFail = 0;
  if (token && rest.length) {
    for (let start = 0; start < rest.length; start += 6) {
      const batch = rest.slice(start, start + 6);
      const user = `Bestehende Einträge (id | Titel | Status | Referenz):\n${existing}\n\nKandidaten:\n\n${batch.map((c, k) => describe(c, k)).join("\n\n")}`;
      let content = null;
      for (const model of models) {
        try { content = await callModel(model, token, user); break; }
        catch (e) { log.push(`KI nicht verfügbar: ${e.message}`); }
      }
      const parsed = content ? extractJson(content) : null;
      if (!parsed || !Array.isArray(parsed.items)) { aiFail += batch.length; continue; }
      for (const it of parsed.items) {
        const c = batch[Number(it.i)];
        if (c) decided.set(c, it);
      }
      aiOk += batch.length;
    }
  }

  // 3) Entscheidungen umsetzen, sonst Regeln
  let fallbackNews = 0;
  for (const c of rest) {
    const d = decided.get(c);
    if (d && d.action === "update" && issues.some((i) => i.id === d.target)) {
      const fields = { sources: srcOf(c) };
      for (const k of ["summary", "impact", "ref"]) if (clean(d[k])) fields[k] = clean(d[k]);
      if (SEVERITIES.includes(d.severity)) fields.severity = d.severity;
      if (STATUSES.includes(d.status)) fields.status = d.status;
      answer.updates.push({ id: d.target, fields });
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
    } else if (!d && GROUNDING_NEWS.test(c.title) && fallbackNews < 2) {
      answer.new.push({ ...heuristicNews(c), operators: [], sources: srcOf(c) });
      fallbackNews++;
    }
  }

  const mode = !token ? "Regeln" : aiFail === 0 ? "KI" : aiOk === 0 ? "Regeln (KI nicht verfügbar)" : "KI teilweise";
  return { answer, mode, log };
}
