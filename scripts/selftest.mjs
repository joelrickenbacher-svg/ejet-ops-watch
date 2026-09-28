// Offline-Selbsttest der Einarbeitungslogik. Läuft vor jedem Update.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyAnswer, collectSearchUrls, extractJson, zurichISO, normUrl } from "./merge.mjs";

const data = JSON.parse(await readFile(new URL("../data/issues.json", import.meta.url), "utf8"));
assert.ok(Array.isArray(data.issues) && data.issues.length > 0, "Daten vorhanden");

// Suchergebnisse inkl. verschachteltem Code-Execution-Ergebnis
const content = [
  { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.flightglobal.com/a/", title: "A" }] },
  { type: "code_execution_tool_result", content: { nested: [{ type: "web_search_result", url: "https://example.org/b?utm_source=x" }] } },
];
const seen = collectSearchUrls(content);
assert.ok(seen.has(normUrl("https://flightglobal.com/a")));
assert.ok(seen.has(normUrl("https://example.org/b")));

const answer = extractJson('Fertig.\n```json\n' + JSON.stringify({
  new: [
    { title: "Testproblem E2", family: ["E2"], severity: "limitation", status: "active", date: "2026-09-25", summary: "S", impact: "I", sources: [{ title: "A", url: "https://flightglobal.com/a" }] },
    { title: "Erfunden", family: ["E1"], severity: "grounding", status: "active", date: "2026-09-25", summary: "S", impact: "I", sources: [{ url: "https://nicht-gesucht.example/x" }] },
    { title: "Falsche Schwere", family: ["E1"], severity: "katastrophe", status: "active", date: "2026-09-25", summary: "S", impact: "I", sources: [{ url: "https://example.org/b" }] },
  ],
  updates: [
    { id: data.issues[0].id, fields: { status: "resolved", sources: [{ title: "B", url: "https://example.org/b" }] } },
    { id: data.issues[1].id, fields: { status: "resolved" } },
    { id: "gibt-es-nicht", fields: { status: "resolved" } },
  ],
}) + '\n```');

const r = applyAnswer(data, answer, seen, "2026-09-25T06:30:00+02:00");
assert.equal(r.added, 1, "nur der belegte neue Eintrag");
assert.equal(r.updated, 1, "nur das belegte Update");
assert.equal(r.data.issues.length, data.issues.length + 1, "nichts gelöscht");
assert.equal(r.data.issues.find((i) => i.id === data.issues[0].id).status, "resolved");
assert.equal(r.data.issues.find((i) => i.id === data.issues[1].id).status, data.issues[1].status, "unbelegtes Update verworfen");
assert.equal(r.data.lastScan, "2026-09-25T06:30:00+02:00");
assert.match(zurichISO(new Date("2026-01-15T12:00:00Z")), /^2026-01-15T13:00:00\+01:00$/);
assert.match(zurichISO(new Date("2026-07-15T12:00:00Z")), /^2026-07-15T14:00:00\+02:00$/);
console.log("Selbsttest ok –", r.log.length, "Hinweise erwartet verworfen:\n" + r.log.map((l) => "  " + l).join("\n"));

// ---------------------------------------------------------------- Sammler & Aufbereitung (ohne Netz)
const { parseRss, isRelevantNews, parseFederalRegister, isRelevantFaa, familyOf } = await import("./sources.mjs");
const { enrich, heuristicFaa, matchIssue } = await import("./enrich.mjs");

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Embraer E195-E2 jets grounded after GPS fault - FlightGlobal</title><link>https://news.google.com/rss/articles/AAA?oc=5</link><pubDate>Tue, 22 Sep 2026 20:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Embraer E195-E2 jets grounded after GPS fault&lt;/a&gt;&amp;nbsp;&lt;font&gt;FlightGlobal&lt;/font&gt;</description><source url="https://www.flightglobal.com">FlightGlobal</source></item>
<item><title>Airline orders 20 Embraer E195-E2 - Reuters</title><link>https://news.google.com/rss/articles/BBB</link><pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title>Phenom 300 incident in Texas - AvHerald</title><link>https://news.google.com/rss/articles/CCC</link><pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate><source url="https://avherald.com">AvHerald</source></item>
</channel></rss>`;
const items = parseRss(rss);
assert.equal(items.length, 3);
assert.equal(items[0].title, "Embraer E195-E2 jets grounded after GPS fault");
assert.equal(items[0].source, "FlightGlobal");
assert.equal(items[0].date, "2026-09-22");
assert.deepEqual(items.map((i) => isRelevantNews(i.title, i.snippet)), [true, false, false], "Relevanzfilter News");
assert.deepEqual(familyOf("E195-E2 grounded").sort(), ["E2"]);
assert.deepEqual(familyOf("Embraer E175 incident").sort(), ["E1"]);

const fr = parseFederalRegister({ results: [
  { title: "Airworthiness Directives; Embraer S.A. Airplanes", type: "Rule", document_number: "2026-20001", publication_date: "2026-10-05",
    html_url: "https://www.federalregister.gov/documents/2026/10/05/2026-20001/x",
    abstract: "The FAA is adopting a new AD for certain Pratt & Whitney Model PW1500G and PW1900G engines. This AD was prompted by reports of HPC rotor clashing. This AD requires borescope inspections.",
    docket_ids: ["FAA-2026-8816"] },
  { title: "Airworthiness Directives; Embraer S.A. Airplanes", type: "Proposed Rule", document_number: "2026-20002", publication_date: "2026-10-05",
    html_url: "https://www.federalregister.gov/documents/2026/10/05/2026-20002/y",
    abstract: "The FAA proposes to adopt a new AD for certain Embraer S.A. Model EMB-545 and EMB-550 airplanes. This proposed AD was prompted by a seal issue." },
  { title: "Airworthiness Directives; Embraer S.A. Airplanes", type: "Proposed Rule", document_number: "2026-20003", publication_date: "2026-10-06",
    html_url: "https://www.federalregister.gov/documents/2026/10/06/2026-20003/z",
    abstract: "The FAA proposes to adopt a new airworthiness directive (AD) for all Embraer S.A. Model ERJ 190-300 and -400 airplanes. This proposed AD was prompted by reports of flap actuator failures. This proposed AD would require revising the airplane flight manual. Docket No. FAA-2026-9001." },
] });
assert.deepEqual(fr.map(isRelevantFaa), [true, false, true], "Relevanzfilter FAA");
const h = heuristicFaa(fr[2]);
assert.equal(h.status, "proposed"); assert.equal(h.severity, "limitation"); assert.deepEqual(h.family, ["E2"]);
assert.match(h.title, /^FAA NPRM: Reports of flap actuator failures/);

// Ohne KI: Final Rule zu bestehendem NPRM (Docket) → in Kraft; neues NPRM → Regel-Eintrag; News ohne Grounding-Wort → ignoriert
const cands = [fr[0], fr[2], { kind: "news", url: "https://news.google.com/rss/articles/DDD", title: "E190-E2 engine issue under review", source: "X", snippet: "", date: "2026-10-06" }];
const base = { issues: data.issues.map((i) => i.id === "pw1900g-hpc-vsv-bushing-nprm" ? i : i) };
const r1 = await enrich(cands, base.issues, { token: "", models: [] });
assert.equal(r1.mode, "Regeln");
const hasNprm = base.issues.some((i) => i.id === "pw1900g-hpc-vsv-bushing-nprm");
if (hasNprm) assert.equal(r1.answer.updates[0].fields.status, "inforce", "Docket-Abgleich");
assert.equal(r1.answer.new.length, hasNprm ? 1 : 2);

// Mit (simulierter) KI
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [
  { i: 0, action: "new", title: "Test-Eintrag", summary: "S", impact: "I", severity: "watch", status: "monitoring", family: ["E2"], date: "2026-10-06" },
  { i: 1, action: "ignore" },
] }) } }] }), { status: 200 });
const r2 = await enrich([fr[2], cands[2]], data.issues, { token: "t", models: ["m"], endpoint: "https://example.invalid/chat/completions" });
globalThis.fetch = realFetch;
assert.equal(r2.mode, "KI");
assert.equal(r2.answer.new.length, 1); assert.equal(r2.answer.new[0].title, "Test-Eintrag");
const known = new Set([normUrl(fr[2].url), normUrl(cands[2].url)]);
const r3 = applyAnswer(data, r2.answer, known, "2026-10-06T06:30:00+02:00");
assert.equal(r3.added, 1);
console.log("Selbsttest Sammler/Aufbereitung ok");
assert.equal(isRelevantNews("Falha de GPS nos jatos da Embraer foi provavelmente causada por teste em satélite militar americano"), true, "Folgemeldung Embraer GPS");
assert.equal(isRelevantNews("US Air Force satellite test disrupted GPS on airline jets"), true, "Folgemeldung GPS-Test");
assert.equal(isRelevantNews("Embraer reports record quarterly deliveries"), false, "Geschäftsmeldung");
// Regeln: Folgemeldung zur GPS-Störung wird dem GPS-Eintrag zugeordnet
const gps = data.issues.find((i) => /GPS/.test(i.title));
if (gps) {
  const nts = { kind: "news", url: "https://news.google.com/rss/articles/NTS3", title: "Falha de GPS nos jatos da Embraer foi provavelmente causada por teste em satélite militar americano", source: "AEROIN", snippet: "", date: "2026-09-25" };
  assert.equal(matchIssue(nts, data.issues)?.id, gps.id, "Zuordnung GPS");
  const r4 = await enrich([nts], data.issues, { token: "", models: [] });
  const r5 = applyAnswer(data, r4.answer, new Set([normUrl(nts.url)]), "2026-09-28T21:00:00+02:00");
  const g = r5.data.issues.find((i) => i.id === gps.id);
  assert.equal(r5.updated, 1); assert.match(g.latest, /^25\.09\. AEROIN: Falha de GPS/);
  assert.equal(g.sources.at(-1).date, "2026-09-25");
}
assert.equal(matchIssue({ title: "Embraer E175 flap actuator failure", snippet: "" }, data.issues)?.id ?? null, data.issues.find((i) => /Querruder/.test(i.title) && i.family.includes("E1"))?.id ?? null, "keine E2-Zuordnung für E1-Meldung");
console.log("Selbsttest Folgemeldungen ok");

// Meldung hängt schon (per Regeln) am GPS-Eintrag → KI beurteilt sie erneut und ergänzt die Zusammenfassung
if (gps) {
  const nts = { kind: "news", url: "https://news.google.com/rss/articles/NTS3", title: "Falha de GPS nos jatos da Embraer foi provavelmente causada por teste em satélite militar americano", source: "AEROIN", snippet: "", date: "2026-09-25" };
  const pre = structuredClone(data); pre.issues.find((i) => i.id === gps.id).sources.push({ title: "AEROIN – Falha de GPS", url: nts.url, date: nts.date });
  const calls = [];
  globalThis.fetch = async (_u, opt) => {
    const body = JSON.parse(opt.body); calls.push(body);
    if (body.reasoning_effort) return new Response('{"error":{"message":"Unknown name \\"reasoning_effort\\""}}', { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify({ items: [
      { i: 0, action: "update", target: gps.id, summary: "Neuer Stand: Test des Satelliten NTS-3 als wahrscheinliche Ursache (laut Aeroin)." },
    ] }) + "\n```" } }] }), { status: 200 });
  };
  const r6 = await enrich([nts], pre.issues, { token: "t", models: ["m"], endpoint: "https://example.invalid/chat/completions" });
  globalThis.fetch = realFetch;
  assert.equal(calls.length, 2, "ohne reasoning_effort wiederholt");
  assert.equal(r6.mode, "KI"); assert.ok(r6.aiSeen.has(nts));
  const r7 = applyAnswer(pre, r6.answer, new Set([normUrl(nts.url)]), "2026-09-28T21:00:00+02:00");
  assert.equal(r7.updated, 1, "Update trotz bereits vorhandener Quelle");
  assert.match(r7.data.issues.find((i) => i.id === gps.id).summary, /NTS-3/);
  // ohne KI: nicht als erledigt markiert
  const r8 = await enrich([nts], pre.issues, { token: "", models: [] });
  assert.equal(r8.aiSeen.size, 0);
  console.log("Selbsttest Neubeurteilung ok");
}
