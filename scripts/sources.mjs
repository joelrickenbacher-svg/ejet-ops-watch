// Kandidaten sammeln: FAA-Dokumente aus dem Federal Register und Meldungen aus Google-News-Feeds.
// Reine Funktionen (parse*/filter*) sind ohne Netz testbar.

const UA = "E-Jet-Ops-Watch/1.0 (+https://github.com)";

// ---------------------------------------------------------------- Relevanz

// Muster für E-Jets (E1/E2) und ihre Triebwerke
const EJET = /\b(E-?Jets?|E1[79]5(-?E2)?|E17[05](-?E2)?|E19[05](-?E2)?|E2\b|ERJ[\s-]?1[79]0|ERJ[\s-]?190-[1234]00|Embraer\s?1[79][05]|PW1900G|CF34-(8E|10E)|Primus Epic)/i;
// Nicht im Umfang
const OUT_OF_SCOPE = /\b(EMB-?505|EMB-?545|EMB-?550|EMB-?135|EMB-?145|EMB-?120|Phenom|Praetor|Legacy 4|Legacy 5|KC-390|C-390|Super Tucano|Eve\b|eVTOL)/i;
// Hinweise auf ein Problem mit Wirkung auf den Betrieb
const PROBLEM = /(ground|AOG|aircraft on ground|inspect|directive|\bAD\b|NPRM|fault|failure|malfunction|issue|problem|incident|emergency|diver|shutdown|recall|crack|defect|glitch|outage|disrupt|cancel|safety|störung|ausfall|problem|panne|notlandung|falha|pane|problema|falla|incidente|emergencia|aterriz|solo)/i;
// Reine Geschäftsmeldungen
const BUSINESS = /(\border(s|ed)?\b|deliver(y|ies|ed)|lease|leasing|financ|backlog|share price|stock|earnings|revenue|livery|route launch|new route|bestell|auslieferung|encomenda|entrega|pedido|ações|acciones)/i;

// Folgethemen: GPS-/Avionik-Störungen, die E-Jets betreffen können
const FOLLOWUP = /(GPS|GNSS|Primus Epic|Honeywell|NTS-3|satellit|satélite|satelite|avionic|aviônic)/i;

export function isRelevantNews(title, snippet = "") {
  const t = `${title} ${snippet}`;
  const ejet = EJET.test(t) || /\bEmbraer\b/i.test(t);
  if (!ejet && !(FOLLOWUP.test(t) && /(aircraft|airline|jets?|avi(ões|ones)|flugzeug|aeronave)/i.test(t) && /(GPS|GNSS)/i.test(t))) return false;
  if (OUT_OF_SCOPE.test(t) && !/E-?Jet|E1[79]5|E19[05]|E2\b|ERJ|GPS|GNSS/i.test(t)) return false;
  if (!PROBLEM.test(t)) return false;
  if (BUSINESS.test(title) && !/(ground|AOG|fault|failure|directive|störung|falha|pane)/i.test(title)) return false;
  return true;
}

export function isRelevantFaa(doc) {
  const t = `${doc.title || ""} ${doc.abstract || ""}`;
  const ejet = /ERJ[\s-]?170|ERJ[\s-]?190|PW1900G|CF34-8E|CF34-10E/i.test(t);
  if (!ejet) return false;
  // Nur Business-Jets/ältere Typen genannt → nicht relevant
  const onlyOther = OUT_OF_SCOPE.test(t) && !/ERJ[\s-]?1[79]0|PW1900G|CF34-(8E|10E)/i.test(t);
  return !onlyOther;
}

export function familyOf(text) {
  const t = text || "";
  const fam = new Set();
  if (/E1[79]5-?E2|E190-?E2|E2\b|ERJ[\s-]?190-[34]00|PW1900G|Primus Epic 2/i.test(t)) fam.add("E2");
  if (/ERJ[\s-]?170|ERJ[\s-]?190-[12]00|ERJ[\s-]?190(?!-[34])|\bE17[05]\b(?!-?E2)|\bE19[05]\b(?!-?E2)|CF34-(8E|10E)|Embraer 1[79][05]\b/i.test(t)) fam.add("E1");
  return [...fam];
}

// ---------------------------------------------------------------- Federal Register

export function parseFederalRegister(json) {
  return (json?.results || []).map((r) => ({
    kind: "faa",
    url: r.html_url,
    title: r.title || "",
    abstract: r.abstract || "",
    type: r.type || "", // "Rule" | "Proposed Rule"
    date: r.publication_date || "",
    docNumber: r.document_number || "",
    dockets: Array.isArray(r.docket_ids) && r.docket_ids.length
      ? r.docket_ids
      : [...new Set(`${r.abstract || ""} ${r.excerpts || ""}`.match(/FAA-\d{4}-\d{3,6}/g) || [])],
  }));
}

export async function fetchFederalRegister(sinceDate) {
  const terms = ["ERJ 170", "ERJ 190", "PW1900G", "CF34-8E", "CF34-10E"];
  const out = new Map();
  for (const term of terms) {
    const p = new URLSearchParams();
    p.set("conditions[term]", term);
    p.append("conditions[agencies][]", "federal-aviation-administration");
    p.append("conditions[type][]", "RULE");
    p.append("conditions[type][]", "PRORULE");
    p.set("conditions[publication_date][gte]", sinceDate);
    for (const f of ["title", "type", "abstract", "document_number", "html_url", "publication_date", "docket_ids", "excerpts"]) p.append("fields[]", f);
    p.set("order", "newest");
    p.set("per_page", "50");
    const res = await fetch("https://www.federalregister.gov/api/v1/documents.json?" + p, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Federal Register ${res.status}`);
    for (const d of parseFederalRegister(await res.json())) if (d.url && !out.has(d.url)) out.set(d.url, d);
  }
  return [...out.values()].filter(isRelevantFaa);
}

// ---------------------------------------------------------------- Google News RSS

const NEWS_QUERIES = [
  { q: '("E195-E2" OR "E190-E2" OR "Embraer E2") (grounded OR AOG OR fault OR failure OR problem OR inspection OR directive)', hl: "en-US", gl: "US", ceid: "US:en" },
  { q: '("Embraer E175" OR "Embraer E190" OR "Embraer E195" OR "E-Jet") (grounded OR incident OR directive OR inspection OR emergency)', hl: "en-US", gl: "US", ceid: "US:en" },
  { q: '"PW1900G" OR "CF34-8E" OR "CF34-10E"', hl: "en-US", gl: "US", ceid: "US:en" },
  { q: 'Embraer (E2 OR E195 OR E190 OR E175) (Störung OR Ausfall OR Grounding OR Problem OR Notlandung)', hl: "de", gl: "CH", ceid: "CH:de" },
  { q: 'Embraer (E2 OR E195 OR E190) (falha OR pane OR problema OR solo OR ANAC)', hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" },
  { q: 'Embraer (falha OR pane OR problema OR GPS OR satélite OR ANAC)', hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" },
  { q: '(GPS OR GNSS) (Embraer OR "Primus Epic" OR Honeywell OR "NTS-3") (aircraft OR airlines OR jets OR satellite)', hl: "en-US", gl: "US", ceid: "US:en" },
];

const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const stripTags = (s) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? m[1] : ""; };

export function parseRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const sourceMatch = it.match(/<source\b[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? stripTags(sourceMatch[2]) : "";
    let title = stripTags(tag(it, "title"));
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const pub = new Date(stripTags(tag(it, "pubDate")));
    let snippet = stripTags(tag(it, "description"));
    if (snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
    if (source && snippet.endsWith(source)) snippet = snippet.slice(0, -source.length).trim();
    items.push({
      kind: "news",
      url: stripTags(tag(it, "link")),
      title,
      source,
      sourceHome: sourceMatch ? sourceMatch[1] : "",
      snippet: snippet.slice(0, 400),
      date: isNaN(pub) ? "" : pub.toISOString().slice(0, 10),
    });
  }
  return items;
}

export async function fetchNews(days) {
  const out = new Map();
  const seenTitles = new Set();
  for (const nq of NEWS_QUERIES) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${nq.q} when:${days}d`)}&hl=${nq.hl}&gl=${nq.gl}&ceid=${nq.ceid}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) { console.warn(`News-Feed ${res.status}: ${nq.q}`); continue; }
      for (const it of parseRss(await res.text())) {
        const key = it.title.toLowerCase().replace(/[^a-z0-9äöüàéèç]+/g, " ").trim();
        if (!it.url || seenTitles.has(key) || out.has(it.url)) continue;
        if (!isRelevantNews(it.title, it.snippet)) continue;
        seenTitles.add(key);
        out.set(it.url, it);
      }
    } catch (e) {
      console.warn(`News-Feed nicht erreichbar (${e.message}): ${nq.q}`);
    }
  }
  return [...out.values()];
}
