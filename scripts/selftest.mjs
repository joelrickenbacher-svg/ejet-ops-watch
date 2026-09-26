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
