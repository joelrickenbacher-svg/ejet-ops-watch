/* E-Jet Ops Watch – installierbare Web-App (PWA). Keine Abhängigkeiten. */
(() => {
  "use strict";

  const DATA_URL = "data/issues.json";
  const SEV = {
    grounding:  { label: "Grounding / AOG", short: "Grounding", rank: 0 },
    limitation: { label: "Betriebseinschränkung", short: "Einschränkung", rank: 1 },
    inspection: { label: "Inspektion / Wartung", short: "Inspektion", rank: 2 },
    watch:      { label: "Beobachten", short: "Beobachten", rank: 3 },
  };
  const STATUS = { active: "Aktiv", proposed: "Vorgeschlagen (NPRM)", inforce: "In Kraft", monitoring: "Beobachtung", resolved: "Erledigt" };
  const TITLES = { lage: "Lage", liste: "Einträge", merkliste: "Merkliste", info: "Info" };
  const NATIVE = typeof window.Android === "object" && window.Android !== null; // in der Android-App
  function apkUrl() {
    // Auf GitHub Pages (<name>.github.io/<repo>/) zeigt der Link auf die neueste APK im Release.
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    const repo = location.pathname.split("/").filter(Boolean)[0];
    return m && repo ? `https://github.com/${m[1]}/${repo}/releases/latest/download/ejet-ops-watch.apk` : null;
  }

  /* ---------- lokaler Speicher (pro Gerät) ---------- */
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem("ejw:" + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem("ejw:" + key, JSON.stringify(value)); } catch { /* privat / voll */ } },
  };

  const state = {
    data: null,
    online: navigator.onLine,
    fromCache: false,
    seen: store.get("seen", null),        // {id: updatedISO}
    stars: store.get("stars", []),        // [id]
    notes: store.get("notes", {}),        // {id: text}
    prefs: store.get("prefs", { family: "all", theme: "system", showResolved: false }),
    filter: { q: "", sev: null, family: null },
    scroll: {},
  };
  if (!state.prefs.family) state.prefs.family = "all";
  state.filter.family = state.prefs.family;

  const $ = (sel) => document.querySelector(sel);
  const view = $("#view");

  /* ---------- Hilfsfunktionen ---------- */
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : "#"; } catch { return "#"; } };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  function fmtDate(s, withTime) {
    if (!s) return "–";
    const d = new Date(s.length <= 10 ? s + "T00:00:00" : s);
    if (isNaN(d)) return s;
    const date = d.toLocaleDateString("de-CH", { day: "2-digit", month: "short", year: "numeric" });
    return withTime ? `${date}, ${d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}` : date;
  }
  function ago(s) {
    const d = new Date(s); if (isNaN(d)) return "";
    const min = Math.round((Date.now() - d) / 60000);
    if (min < 1) return "gerade eben";
    if (min < 60) return `vor ${min} Min.`;
    const h = Math.round(min / 60); if (h < 36) return `vor ${h} Std.`;
    return `vor ${Math.round(h / 24)} Tagen`;
  }
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400);
  }
  const issues = () => (state.data?.issues || []);
  const byId = (id) => issues().find((i) => i.id === id);
  const sevOf = (it) => (SEV[it.severity] ? it.severity : "watch");
  const isNew = (it) => state.seen && (!(it.id in state.seen) || String(it.updated || "") > String(state.seen[it.id] || ""));
  const newKind = (it) => (state.seen && !(it.id in state.seen) ? "Neu" : "Aktualisiert");
  function famOk(it, fam) { return !fam || fam === "all" || (it.family || []).includes(fam); }
  function sortIssues(list) {
    return [...list].sort((a, b) => {
      const ra = a.status === "resolved" ? 1 : 0, rb = b.status === "resolved" ? 1 : 0;
      if (ra !== rb) return ra - rb;
      const s = SEV[sevOf(a)].rank - SEV[sevOf(b)].rank; if (s) return s;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
  }
  function markSeen(ids) {
    if (!state.seen) state.seen = {};
    ids.forEach((id) => { const it = byId(id); if (it) state.seen[id] = it.updated || it.date || "seen"; });
    store.set("seen", state.seen);
    updateBadges();
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    const t = state.prefs.theme;
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme();

  /* ---------- Daten laden ---------- */
  async function load(manual) {
    const btn = $("#refreshBtn"); btn.classList.add("spin");
    try {
      const res = await fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      state.fromCache = res.headers.get("x-ejw-cache") === "1";
      const prevScan = state.data?.lastScan;
      state.data = json;
      store.set("data", json);
      // Erster Start: alles gilt als gesehen, damit nicht 13x "Neu" erscheint.
      if (!state.seen) { state.seen = {}; markSeen(issues().map((i) => i.id)); }
      if (manual) toast(prevScan && prevScan === json.lastScan ? "Keine neuen Daten" : "Aktualisiert");
    } catch (e) {
      const cached = store.get("data", null);
      if (cached && !state.data) state.data = cached;
      state.fromCache = true;
      if (manual) toast("Offline – zeige gespeicherte Daten");
      if (!state.data) { view.innerHTML = `<div class="empty" style="margin-top:24px">Daten konnten nicht geladen werden. Prüfe die Verbindung und tippe oben rechts auf Aktualisieren.</div>`; }
    } finally {
      btn.classList.remove("spin");
      renderStatus(); updateBadges();
      if (state.data) route();
    }
  }

  function renderStatus() {
    const el = $("#statusline");
    const offline = !navigator.onLine || state.fromCache;
    el.classList.toggle("offline", offline);
    if (!state.data) { el.innerHTML = ""; return; }
    el.innerHTML = `<span class="dot"></span><span>${offline ? "Offline · " : ""}Letzter Scan ${esc(fmtDate(state.data.lastScan, true))} · ${esc(ago(state.data.lastScan))}</span>`;
  }

  function updateBadges() {
    const n = issues().filter((i) => i.status !== "resolved" && isNew(i)).length;
    const tab = document.querySelector('.tabbar a[data-tab="lage"]');
    let b = tab.querySelector(".badge");
    if (n) { if (!b) { b = document.createElement("span"); b.className = "badge"; tab.appendChild(b); } b.textContent = n; b.setAttribute("aria-label", `${n} neu`); }
    else if (b) b.remove();
    if ("setAppBadge" in navigator) { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); }
  }

  /* ---------- Bausteine ---------- */
  function card(it) {
    const sev = sevOf(it);
    const fams = (it.family || []).map((f) => `<span class="fam">${esc(f)}</span>`).join("");
    const nw = isNew(it) && it.status !== "resolved" ? `<span class="pill new">${newKind(it)}</span>` : "";
    const star = state.stars.includes(it.id) ? `<span class="star-mark" aria-label="Gemerkt"><svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg></span>` : "";
    return `<a class="card s-${sev} ${it.status === "resolved" ? "resolved" : ""}" href="#/eintrag/${encodeURIComponent(it.id)}">
      ${star}
      <div class="tags">${nw}<span class="pill s-${sev}">${SEV[sev].short}</span>${fams}<span class="st ${esc(it.status)}">${esc(STATUS[it.status] || it.status || "")}</span></div>
      <h3>${esc(it.title)}</h3>
      <p>${esc(it.summary)}</p>
      ${it.latest && it.status !== "resolved" ? `<div class="latest"><span>Neu: ${esc(it.latest)}</span></div>` : ""}
      <div class="foot"><span>${esc(fmtDate(it.date))}</span>${it.ref ? `<span>${esc(it.ref)}</span>` : ""}</div>
    </a>`;
  }
  const cards = (list, emptyMsg) => list.length ? `<div class="cards">${list.map(card).join("")}</div>` : `<div class="empty">${emptyMsg}</div>`;

  /* ---------- Screens ---------- */
  function screenLage() {
    const fam = state.prefs.family;
    const open = issues().filter((i) => i.status !== "resolved" && famOk(i, fam));
    const tiles = Object.entries(SEV).map(([k, v]) => {
      const n = open.filter((i) => sevOf(i) === k).length;
      return `<a class="tile s-${k}" href="#/liste?sev=${k}"><span class="n">${n}</span><span class="l">${v.label}</span></a>`;
    }).join("");
    const fresh = sortIssues(open.filter(isNew));
    const urgent = sortIssues(open.filter((i) => (i.severity === "grounding" || i.severity === "limitation") && (i.status === "active" || i.status === "monitoring" || i.status === "proposed")));
    const famSeg = ["all", "E1", "E2"].map((f) => `<button type="button" data-fam="${f}" aria-pressed="${fam === f}">${f === "all" ? "Alle" : f}</button>`).join("");
    view.innerHTML = `
      <section class="section">
        <div class="section-h"><h2>Offene Punkte</h2><div class="seg" role="group" aria-label="Flugzeugfamilie">${famSeg}</div></div>
        <div class="board">${tiles}</div>
      </section>
      ${fresh.length ? `<section class="section">
        <div class="section-h"><h2>Neu seit deinem letzten Besuch</h2><button class="link-btn" type="button" id="readAll">Alle gelesen</button></div>
        ${cards(fresh)}
      </section>` : ""}
      <section class="section">
        <div class="section-h"><h2>Akut: Grounding & Einschränkungen</h2></div>
        ${cards(urgent.filter((i) => !fresh.includes(i)), fresh.length ? "Alle akuten Punkte stehen oben unter „Neu“." : "Aktuell keine akuten Einschränkungen.")}
      </section>`;
    view.querySelectorAll("[data-fam]").forEach((b) => b.addEventListener("click", () => {
      state.prefs.family = b.dataset.fam; state.filter.family = b.dataset.fam; store.set("prefs", state.prefs); screenLage();
    }));
    $("#readAll")?.addEventListener("click", () => { markSeen(issues().map((i) => i.id)); toast("Alle als gelesen markiert"); screenLage(); });
  }

  function screenListe(params) {
    if (params.get("sev")) state.filter.sev = params.get("sev");
    const f = state.filter;
    const chip = (key, val, label) => `<button type="button" class="chip" data-k="${key}" data-v="${val}" aria-pressed="${(f[key] || (key === "family" ? "all" : null)) === val}">${label}</button>`;
    view.innerHTML = `
      <div class="filters">
        <input class="search" id="q" type="search" inputmode="search" placeholder="Suche: Airline, AD-Nummer, System …" aria-label="Suche" value="${esc(f.q)}">
        <div class="chips" role="group" aria-label="Filter">
          ${chip("family", "all", "Alle")}${chip("family", "E1", "E1")}${chip("family", "E2", "E2")}
          ${Object.entries(SEV).map(([k, v]) => chip("sev", k, v.short)).join("")}
        </div>
        <span class="count" id="count"></span>
      </div>
      <div id="results"></div>`;
    const draw = () => {
      const q = f.q.toLowerCase();
      const list = sortIssues(issues().filter((it) => {
        if (!state.prefs.showResolved && it.status === "resolved") return false;
        if (!famOk(it, f.family)) return false;
        if (f.sev && sevOf(it) !== f.sev) return false;
        if (q) {
          const hay = [it.title, it.summary, it.impact, it.ref, it.models, it.system, (it.operators || []).join(" ")].join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }));
      $("#count").textContent = `${list.length} ${list.length === 1 ? "Eintrag" : "Einträge"}${state.prefs.showResolved ? "" : " · Erledigte ausgeblendet"}`;
      $("#results").innerHTML = cards(list, "Keine Einträge für diese Auswahl.");
    };
    view.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.k, v = b.dataset.v;
      if (k === "sev") f.sev = f.sev === v ? null : v; else f.family = v;
      view.querySelectorAll(`.chip[data-k="${k}"]`).forEach((x) => x.setAttribute("aria-pressed", String((k === "sev" ? f.sev : f.family) === x.dataset.v)));
      draw();
    }));
    let t; $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); draw(); }, 120); });
    draw();
  }

  function screenMerkliste() {
    const list = sortIssues(state.stars.map(byId).filter(Boolean));
    view.innerHTML = `<section class="section">
      <div class="section-h"><h2>Gemerkte Einträge</h2></div>
      ${cards(list, "Noch nichts gemerkt. Öffne einen Eintrag und tippe auf „Merken“, um ihn hier zu sammeln.")}
    </section>`;
  }

  function screenEintrag(id) {
    const it = byId(id);
    if (!it) { view.innerHTML = `<div class="empty" style="margin-top:24px">Diesen Eintrag gibt es nicht mehr.</div>`; return; }
    const sev = sevOf(it);
    const wasNew = isNew(it);
    markSeen([it.id]);
    const starred = state.stars.includes(it.id);
    const fams = (it.family || []).map((f) => `<span class="fam">${esc(f)}</span>`).join("");
    const srcList = (it.sources || []).map((s, i) => ({ ...s, _i: i })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b._i - a._i);
    const src = srcList.map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener"><div>${esc(s.title || s.url)}</div><span>${s.date ? esc(fmtDate(s.date)) + " · " : ""}${esc(host(s.url))} ↗</span></a></li>`).join("");
    view.innerHTML = `<article class="detail">
      <div class="tags">${wasNew ? `<span class="pill new">${newKind(it)}</span>` : ""}<span class="pill s-${sev}">${SEV[sev].label}</span>${fams}<span class="st ${esc(it.status)}">${esc(STATUS[it.status] || it.status || "")}</span></div>
      <h2>${esc(it.title)}</h2>
      <p class="lead">${esc(it.summary)}</p>
      <div class="actions">
        <button class="btn ${starred ? "primary" : ""}" id="starBtn" type="button" aria-pressed="${starred}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>${starred ? "Gemerkt" : "Merken"}</button>
        <button class="btn" id="shareBtn" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/></svg>Teilen</button>
      </div>
      ${it.latest ? `<div class="block"><span class="label">Neueste Meldung</span><p>${esc(it.latest)}</p><p class="hint">Automatisch zugeordnet – Details in den Quellen unten.</p></div>` : ""}
      <div class="block impact"><span class="label">Operationelle Auswirkung</span><p>${esc(it.impact || "–")}</p></div>
      <div class="facts">
        <div><span class="label">Datum</span><span class="mono">${esc(fmtDate(it.date))}</span></div>
        <div><span class="label">Status</span><span>${esc(STATUS[it.status] || it.status || "–")}</span></div>
        <div class="full"><span class="label">Referenz</span><span class="mono">${esc(it.ref || "–")}</span></div>
        ${it.deadline ? `<div class="full"><span class="label">Frist</span><span class="mono">${esc(it.deadline)}</span></div>` : ""}
        <div class="full"><span class="label">Betroffene Typen</span><span>${esc(it.models || "–")}</span></div>
        <div class="full"><span class="label">System</span><span>${esc(it.system || "–")}</span></div>
        ${(it.operators || []).length ? `<div class="full"><span class="label">Gemeldete Betreiber</span><span>${esc(it.operators.join(", "))}</span></div>` : ""}
      </div>
      ${src ? `<div class="block"><span class="label">Quellen</span><ul class="sources">${src}</ul></div>` : ""}
      <div class="block">
        <label class="label" for="note">Eigene Notiz</label>
        <textarea id="note" placeholder="z. B. betrifft unsere HB-Registrierungen, SB bestellt …">${esc(state.notes[it.id] || "")}</textarea>
        <p class="hint">Bleibt nur auf diesem Gerät gespeichert.</p>
      </div>
      <p class="hint">Eintrag aktualisiert: ${esc(fmtDate(it.updated, true))}</p>
    </article>`;
    $("#starBtn").addEventListener("click", () => {
      const i = state.stars.indexOf(it.id);
      if (i >= 0) state.stars.splice(i, 1); else state.stars.push(it.id);
      store.set("stars", state.stars);
      toast(i >= 0 ? "Von Merkliste entfernt" : "Gemerkt");
      screenEintrag(it.id);
    });
    let nt; $("#note").addEventListener("input", (e) => {
      clearTimeout(nt); nt = setTimeout(() => {
        const v = e.target.value; if (v.trim()) state.notes[it.id] = v; else delete state.notes[it.id]; store.set("notes", state.notes);
      }, 300);
    });
    $("#shareBtn").addEventListener("click", async () => {
      const src = (it.sources || [])[0]?.url || "";
      const text = `${it.title}\n${SEV[sev].label} · ${STATUS[it.status] || ""}\n${it.summary}${src ? "\nQuelle: " + src : ""}`;
      if (NATIVE && window.Android.share) { window.Android.share(it.title, text); return; }
      const url = location.href;
      if (navigator.share) { try { await navigator.share({ title: it.title, text, url }); } catch { /* abgebrochen */ } return; }
      try { await navigator.clipboard.writeText(`${text}\n${url}`); toast("In die Zwischenablage kopiert"); } catch { toast("Teilen nicht möglich"); }
    });
  }

  function notifySection() {
    let level = "all", allowed = true, version = "", canTest = false;
    try { level = window.Android.getNotifyLevel(); allowed = window.Android.notificationsAllowed(); version = window.Android.appVersion(); canTest = typeof window.Android.testNotification === "function"; } catch { /* ältere App */ }
    const b = (v, l) => `<button type="button" data-notify="${v}" aria-pressed="${level === v}">${l}</button>`;
    return `<section class="section">
        <div class="section-h"><h2>Benachrichtigungen</h2></div>
        <div class="info-list">
          <div class="row"><span>Melden bei</span><div class="seg" role="group" aria-label="Benachrichtigungen">${b("all", "Allem")}${b("urgent", "Akut")}${b("off", "Aus")}</div></div>
          <div class="prose"><p class="hint" style="margin:0">„Allem“ meldet jeden neuen Eintrag und jedes inhaltliche Update (z. B. gefundene Ursache, AD in Kraft, behoben). „Akut“ nur bei Groundings und Betriebseinschränkungen. Die App prüft etwa stündlich; neue Daten gibt es um 06:30 und 17:30.${!allowed && level !== "off" ? " <b>Benachrichtigungen sind in den Android-Einstellungen blockiert.</b>" : ""}</p></div>
          ${canTest ? `<div class="row"><span>Test</span><button type="button" class="btn" id="testNotify">Test-Benachrichtigung</button></div>` : ""}
          ${version ? `<div class="row"><span>App-Version</span><span class="mono">${esc(version)}</span></div>` : ""}
        </div>
      </section>`;
  }

  function screenInfo() {
    const d = state.data || {};
    const th = state.prefs.theme;
    const seg = (v, l) => `<button type="button" data-theme-v="${v}" aria-pressed="${th === v}">${l}</button>`;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    view.innerHTML = `
      <section class="section">
        <div class="section-h"><h2>Datenstand</h2></div>
        <div class="info-list">
          <div class="row"><span>Letzter Scan</span><span class="mono">${esc(fmtDate(d.lastScan, true))}</span></div>
          <div class="row"><span>Ergebnis</span><span class="mono">${esc(d.note || "–")}</span></div>
          <div class="row"><span>Einträge gesamt</span><span class="mono">${issues().length}</span></div>
        </div>
      </section>
      <section class="section">
        <div class="section-h"><h2>Einstellungen</h2></div>
        <div class="info-list">
          <div class="row"><span>Darstellung</span><div class="seg" role="group" aria-label="Darstellung">${seg("system", "Auto")}${seg("light", "Hell")}${seg("dark", "Dunkel")}</div></div>
          <label class="row" for="showResolved"><span>Erledigte Einträge zeigen</span><input type="checkbox" id="showResolved" ${state.prefs.showResolved ? "checked" : ""}></label>
          <div class="row"><span>Lokale Daten (Merkliste, Notizen)</span><button class="link-btn" type="button" id="resetBtn">Zurücksetzen</button></div>
        </div>
        <div class="empty" id="resetConfirm" hidden>
          <p style="margin:0 0 10px">Merkliste, Notizen und Gelesen-Status auf diesem Gerät löschen?</p>
          <div class="actions"><button class="btn" type="button" id="resetNo">Abbrechen</button><button class="btn primary" type="button" id="resetYes">Löschen</button></div>
        </div>
      </section>
      ${NATIVE ? notifySection() : ""}
      ${NATIVE || standalone ? "" : `<section class="section">
        <div class="section-h"><h2>Als App installieren</h2></div>
        <div class="block prose">
          ${ios ? `<p>In Safari unten auf <b>Teilen</b> tippen, dann <b>Zum Home-Bildschirm</b>.</p>` : `<p>Im Browser-Menü <b>App installieren</b> bzw. <b>Zum Startbildschirm hinzufügen</b> wählen.</p>`}
          <p>Danach startet Ops Watch wie eine normale App, im Vollbild und auch offline.</p>
          <button class="btn primary" type="button" id="installBtn" hidden>Jetzt installieren</button>
          ${apkUrl() ? `<p>Lieber eine echte Android-App mit Benachrichtigungen? <a href="${esc(apkUrl())}">Android-App (APK) herunterladen</a></p>` : ""}
        </div>
      </section>`}
      <section class="section">
        <div class="section-h"><h2>Über die Daten</h2></div>
        <div class="block prose">
          <p>Ops Watch sammelt Probleme bei Embraer E1 (E170/175/190/195, GE CF34) und E2 (E190-E2/E195-E2, P&amp;W PW1900G), die zu Einschränkungen im Flugbetrieb führen können: Lufttüchtigkeitsanweisungen (FAA, EASA, ANAC), Groundings, Triebwerks- und Avionikprobleme.</p>
          <p>Die Daten werden täglich automatisch recherchiert und mit Primärquellen verlinkt. Sie ersetzen nicht die verbindlichen ADs und Service Bulletins deines Betriebs.</p>
        </div>
      </section>`;
    view.querySelectorAll("[data-theme-v]").forEach((b) => b.addEventListener("click", () => { state.prefs.theme = b.dataset.themeV; store.set("prefs", state.prefs); applyTheme(); screenInfo(); }));
    $("#showResolved").addEventListener("change", (e) => { state.prefs.showResolved = e.target.checked; store.set("prefs", state.prefs); });
    $("#resetBtn").addEventListener("click", () => { $("#resetConfirm").hidden = false; });
    $("#resetNo").addEventListener("click", () => { $("#resetConfirm").hidden = true; });
    $("#resetYes").addEventListener("click", () => {
      state.stars = []; state.notes = {}; state.seen = {}; markSeen(issues().map((i) => i.id));
      store.set("stars", []); store.set("notes", {}); $("#resetConfirm").hidden = true; toast("Lokale Daten gelöscht");
    });
    view.querySelectorAll("[data-notify]").forEach((b) => b.addEventListener("click", () => {
      try { window.Android.setNotifyLevel(b.dataset.notify); } catch { /* ältere App */ }
      toast(b.dataset.notify === "off" ? "Benachrichtigungen aus" : "Benachrichtigungen an");
      setTimeout(screenInfo, 400);
    }));
    const tn = $("#testNotify");
    if (tn) tn.addEventListener("click", () => { try { window.Android.testNotification(); } catch { /* ältere App */ } });
    const ib = $("#installBtn");
    if (ib && deferredInstall) { ib.hidden = false; ib.addEventListener("click", async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; ib.hidden = true; }); }
  }

  /* ---------- Router ---------- */
  function route() {
    if (!state.data) return;
    const hash = location.hash || "#/lage";
    const [path, query] = hash.slice(2).split("?");
    const params = new URLSearchParams(query || "");
    const [screen, arg] = path.split("/");
    const isDetail = screen === "eintrag";
    const tab = isDetail ? (route.lastTab || "liste") : (TITLES[screen] ? screen : "lage");
    if (!isDetail) route.lastTab = tab;

    document.querySelectorAll(".tabbar a").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $("#backBtn").hidden = !isDetail;
    $("#screenTitle").textContent = isDetail ? "Eintrag" : TITLES[tab];
    $("#eyebrow").textContent = isDetail ? "E-Jet Ops Watch" : "Embraer E1 · E2";
    document.title = isDetail ? `${byId(decodeURIComponent(arg || ""))?.title || "Eintrag"} · Ops Watch` : "E-Jet Ops Watch";

    if (isDetail) screenEintrag(decodeURIComponent(arg || ""));
    else if (tab === "liste") screenListe(params);
    else if (tab === "merkliste") screenMerkliste();
    else if (tab === "info") screenInfo();
    else screenLage();

    const key = isDetail ? "detail" : tab;
    window.scrollTo(0, isDetail ? 0 : (state.scroll[key] || 0));
  }
  window.addEventListener("hashchange", () => {
    // Scrollposition der verlassenen Liste merken
    if (route.lastTab) state.scroll[route.lastTab] = route._y || 0;
    route();
  });
  window.addEventListener("scroll", () => { if (!location.hash.startsWith("#/eintrag")) route._y = window.scrollY; }, { passive: true });
  $("#backBtn").addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/" + (route.lastTab || "liste"); });
  $("#refreshBtn").addEventListener("click", () => load(true));
  window.addEventListener("online", () => { renderStatus(); load(false); });
  window.addEventListener("offline", renderStatus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.data && Date.now() - (load._last || 0) > 10 * 60 * 1000) { load._last = Date.now(); load(false); }
  });

  /* ---------- Installation & Service Worker ---------- */
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; if (location.hash.startsWith("#/info")) screenInfo(); });
  if (!NATIVE && "serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  /* ---------- Start ---------- */
  const cached = store.get("data", null);
  if (cached) { state.data = cached; state.fromCache = true; if (!state.seen) { state.seen = {}; markSeen(issues().map((i) => i.id)); } renderStatus(); route(); }
  load._last = Date.now();
  load(false);
})();
