/* Tablero de Seguimiento de Medidas — lee /api/data y dibuja todo en el navegador. */
(() => {
  "use strict";

  // ───────────────────────── utilidades ─────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
  const fmt = (n) => nf.format(n);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  const deacc = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const dayDate = (d) => new Date(d * 864e5);
  const dayStr = (d) => { const x = dayDate(d); return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`; };
  const dayISO = (d) => dayDate(d).toISOString().slice(0, 10);
  const isoDay = (s) => (s ? Math.floor(Date.parse(s + "T00:00:00Z") / 864e5) : null);
  const monthKey = (d) => { const x = dayDate(d); return x.getUTCFullYear() * 12 + x.getUTCMonth(); };
  const monthLabel = (k) => [MESES[k % 12], String(Math.floor(k / 12))];
  const weekKey = (d) => d - ((d + 3) % 7); // lunes de la semana
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let DB = null; // { M, A, today }
  let NA = -999999; // "sin fecha" (lo define el servidor)
  const hasDate = (v) => v !== NA;
  const series = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--s${i}`));

  // ───────────────────────── acceso a datos ─────────────────────────
  function wrap(t) {
    const cols = t.cols;
    const maxCode = {};
    return {
      n: t.n,
      c(key) { const v = cols[key]; return Array.isArray(v) ? v : v.c; },
      d(key) { return cols[key].d || null; },
      label(key, code) { return code < 0 ? null : cols[key].d[code]; },
      max(key) {
        if (maxCode[key] === undefined) { let m = -1; for (const x of this.c(key)) if (x > m) m = x; maxCode[key] = m; }
        return maxCode[key];
      },
    };
  }

  // Cantidad de valores distintos de `key` entre las filas `rows`.
  function distinct(T, rows, key, pred) {
    const c = T.c(key);
    const seen = new Uint8Array(T.max(key) + 1);
    let n = 0;
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      if (pred && !pred(i)) continue;
      const v = c[i];
      if (v >= 0 && !seen[v]) { seen[v] = 1; n++; }
    }
    return n;
  }

  // Agrupa por keyFn(i) y cuenta filas (idKey=null) o valores distintos de idKey.
  function groupBy(T, rows, keyFn, idKey) {
    const out = new Map();
    const id = idKey ? T.c(idKey) : null;
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      const k = keyFn(i);
      if (k === null || k === undefined) continue;
      if (!id) { out.set(k, (out.get(k) || 0) + 1); continue; }
      const v = id[i];
      if (v < 0) continue;
      let s = out.get(k);
      if (!s) out.set(k, (s = new Set()));
      s.add(v);
    }
    if (id) for (const [k, s] of out) out.set(k, s.size);
    return out;
  }
  const byCat = (T, key) => { const c = T.c(key); return (i) => (c[i] >= 0 ? c[i] : null); };
  // Lista ordenada [{label, value}] de una categoría.
  function catCounts(T, rows, key, idKey) {
    const m = groupBy(T, rows, byCat(T, key), idKey);
    return [...m].map(([code, value]) => ({ label: T.label(key, code), value })).sort((a, b) => b.value - a.value);
  }
  function topN(list, n, otherLabel = "Otros") {
    if (list.length <= n) return list;
    const head = list.slice(0, n);
    const rest = list.slice(n).reduce((s, x) => s + x.value, 0);
    return [...head, { label: otherLabel, value: rest, other: true }];
  }

  // Colores estables por entidad (no por ranking): se asignan con el orden del total de datos.
  const colorRank = {};
  function colorFor(scope, label) {
    if (label === "Otros") return css("--other");
    const r = colorRank[scope];
    const idx = r ? r.indexOf(label) : -1;
    const pal = series();
    return idx >= 0 && idx < pal.length ? pal[idx] : css("--other");
  }

  // ───────────────────────── gráficos ─────────────────────────
  const charts = {};
  function setChartDefaults() {
    Chart.defaults.font.family = css("--font") || "system-ui";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css("--text-2");
    Chart.defaults.borderColor = css("--grid");
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = { duration: 250 };
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.tooltip.callbacks.label = (ctx) => {
      const v = ctx.parsed && typeof ctx.parsed === "object" ? (ctx.chart.config.type === "bar" ? (ctx.chart.options.indexAxis === "y" ? ctx.parsed.x : ctx.parsed.y) : ctx.parsed) : ctx.parsed;
      return ` ${ctx.dataset.label ? ctx.dataset.label + ": " : ""}${fmt(v)}`;
    };
    Chart.register(ChartDataLabels);
    Chart.defaults.plugins.datalabels = { display: false };
  }
  function draw(id, config) {
    const el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, config);
  }
  const axisCommon = () => ({
    grid: { color: css("--grid"), drawTicks: false },
    border: { color: css("--axis") },
    ticks: { color: css("--muted"), padding: 6, callback(v) { return typeof v === "number" ? fmt(v) : v; } },
  });
  const valueLabels = (horizontal, show = true) => ({
    display: show ? "auto" : false,
    anchor: "end", align: horizontal ? "right" : "end", offset: 2, clamp: true,
    color: css("--text"), font: { size: 11, weight: 600 },
    formatter: (v) => fmt(v),
  });

  function barChart(id, items, { horizontal = false, color, labels } = {}) {
    if (!items.length) return emptyChart(id);
    const col = color || css("--s1");
    const lbls = labels || items.map((x) => x.label);
    const showLabels = items.length <= 26;
    const cat = { ...axisCommon(), grid: { display: false }, ticks: { color: css("--text-2"), autoSkip: !horizontal, maxRotation: 0, font: { size: 11 } } };
    const val = { ...axisCommon(), beginAtZero: true, grace: "12%" };
    draw(id, {
      type: "bar",
      data: { labels: lbls, datasets: [{ data: items.map((x) => x.value), backgroundColor: items.map((x) => (x.other ? css("--other") : col)), borderRadius: 4, borderSkipped: "start", maxBarThickness: 46, categoryPercentage: 0.82, barPercentage: 0.9 }] },
      options: {
        indexAxis: horizontal ? "y" : "x",
        scales: horizontal ? { x: val, y: cat } : { x: cat, y: val },
        plugins: { legend: { display: false }, datalabels: valueLabels(horizontal, showLabels) },
        layout: { padding: { right: horizontal ? 24 : 0, top: 4 } },
      },
    });
  }
  function donutChart(id, items, scope) {
    if (!items.length) return emptyChart(id);
    const total = items.reduce((s, x) => s + x.value, 0);
    draw(id, {
      type: "doughnut",
      data: { labels: items.map((x) => x.label), datasets: [{ data: items.map((x) => x.value), backgroundColor: items.map((x) => colorFor(scope, x.label)), borderColor: css("--surface"), borderWidth: 2 }] },
      options: {
        cutout: "58%",
        plugins: {
          legend: { position: "right", labels: { color: css("--text-2"), padding: 12 } },
          tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed)} (${nf2.format((c.parsed / total) * 100)}%)` } },
          datalabels: {
            display: (c) => c.dataset.data[c.dataIndex] / total >= 0.04,
            color: "#fff", font: { weight: 700, size: 11 },
            formatter: (v) => `${nf2.format((v / total) * 100).replace(/,(\d)\d$/, ",$1")}%`,
          },
        },
      },
    });
  }
  function stackedChart(id, categories, datasets) {
    if (!categories.length) return emptyChart(id);
    draw(id, {
      type: "bar",
      data: { labels: categories, datasets: datasets.map((d) => ({ ...d, borderColor: css("--surface"), borderWidth: { right: 1 }, borderSkipped: false, maxBarThickness: 30 })) },
      options: {
        indexAxis: "y",
        scales: { x: { ...axisCommon(), stacked: true, beginAtZero: true }, y: { ...axisCommon(), stacked: true, grid: { display: false }, ticks: { color: css("--text-2") } } },
        plugins: { legend: { position: "top", align: "start", labels: { color: css("--text-2"), padding: 10 } }, tooltip: { mode: "nearest" } },
      },
    });
  }
  function gaugeChart(id, ratio) {
    const r = Math.max(0, Math.min(1, ratio || 0));
    draw(id, {
      type: "doughnut",
      data: { datasets: [{ data: [r, 1 - r], backgroundColor: [css("--s3"), css("--grid")], borderWidth: 0 }] },
      options: { rotation: -90, circumference: 180, cutout: "72%", plugins: { legend: { display: false }, tooltip: { enabled: false } } },
    });
  }
  function emptyChart(id) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const el = document.getElementById(id);
    if (!el) return;
    const ctx = el.getContext("2d");
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = css("--muted"); ctx.font = "13px system-ui"; ctx.textAlign = "center";
    ctx.fillText("Sin datos para los filtros elegidos", el.width / 2, el.height / 2);
  }

  // Serie mensual completa (rellena meses vacíos con 0).
  function monthlySeries(T, rows, dateKey, idKey, pred) {
    const d = T.c(dateKey);
    const m = groupBy(T, rows, (i) => (hasDate(d[i]) && (!pred || pred(i)) ? monthKey(d[i]) : null), idKey);
    if (!m.size) return [];
    const keys = [...m.keys()];
    const peak = Math.max(...m.values());
    // Arranca en el primer mes con volumen real (descarta fechas sueltas mal cargadas al principio).
    const lo = Math.min(...keys.filter((k) => m.get(k) >= peak * 0.02)), hi = Math.max(...keys);
    const out = [];
    for (let k = lo; k <= hi; k++) out.push({ key: k, label: monthLabel(k), value: m.get(k) || 0 });
    return out;
  }

  // ───────────────────────── tablas ─────────────────────────
  function renderTable(containerId, columns, rows, { pageSize = 15 } = {}) {
    const box = document.getElementById(containerId);
    if (!box) return;
    if (!rows.length) { box.innerHTML = `<div class="empty">Sin datos para los filtros elegidos</div>`; return; }
    const valCol = columns.find((c) => c.value);
    const max = Math.max(...rows.map((r) => r[valCol.key]));
    let page = 0;
    const pages = Math.ceil(rows.length / pageSize);
    const paint = () => {
      const slice = rows.slice(page * pageSize, (page + 1) * pageSize);
      box.innerHTML = `
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th></th>${columns.map((c) => `<th class="${c.value ? "num" : ""}">${esc(c.title)}</th>`).join("")}</tr></thead>
          <tbody>${slice.map((r, j) => `<tr><td class="rk">${page * pageSize + j + 1}.</td>${columns.map((c) => c.value
            ? `<td class="num bar"><i style="width:${(r[c.key] / max) * 100}%"></i><b>${fmt(r[c.key])}</b></td>`
            : `<td>${esc(c.format ? c.format(r[c.key]) : r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        <div class="pager"><span>${fmt(page * pageSize + 1)} – ${fmt(Math.min((page + 1) * pageSize, rows.length))} de ${fmt(rows.length)}</span>
          <button class="ghost" data-p="-1" ${page === 0 ? "disabled" : ""}>‹</button>
          <button class="ghost" data-p="1" ${page >= pages - 1 ? "disabled" : ""}>›</button></div>`;
      box.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => { page += Number(b.dataset.p); paint(); }));
    };
    paint();
  }

  // ───────────────────────── mapa por comuna ─────────────────────────
  const COMUNAS = {
    1: [-34.6118, -58.3703], 2: [-34.5889, -58.3974], 3: [-34.6096, -58.4104], 4: [-34.6476, -58.3965],
    5: [-34.6177, -58.4206], 6: [-34.6159, -58.4421], 7: [-34.6292, -58.452], 8: [-34.6752, -58.4627],
    9: [-34.6593, -58.511], 10: [-34.623, -58.5023], 11: [-34.6004, -58.4931], 12: [-34.566, -58.4876],
    13: [-34.5549, -58.4427], 14: [-34.5806, -58.4251], 15: [-34.5874, -58.4681],
  };
  let comunasGeo; // opcional: public/comunas.geojson
  const geoReady = fetch("comunas.geojson").then((r) => (r.ok ? r.json() : null)).then((g) => (comunasGeo = g)).catch(() => null);
  const maps = {};
  function geoComuna(props) {
    for (const k of Object.keys(props)) {
      if (/comuna/i.test(k)) { const m = String(props[k]).match(/\d+/); if (m) return Number(m[0]); }
    }
    return null;
  }
  function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    return "#" + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, "0")).join("");
  }
  async function renderMap(id, values, unit) {
    await geoReady;
    const el = document.getElementById(id);
    if (!el || typeof L === "undefined") return;
    let m = maps[id];
    if (!m) {
      const map = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView([-34.615, -58.445], 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18,
      }).addTo(map);
      m = maps[id] = { map, layer: L.layerGroup().addTo(map) };
    }
    m.layer.clearLayers();
    const vals = [...values.values()];
    const max = Math.max(1, ...vals);
    const lo = css("--seq-lo"), hi = css("--seq-hi");
    const tip = (n, v) => `<b>Comuna ${n}</b><br>${fmt(v || 0)} ${unit}`;
    if (comunasGeo) {
      L.geoJSON(comunasGeo, {
        style: (f) => { const n = geoComuna(f.properties); const v = values.get(n) || 0; return { color: css("--surface"), weight: 1.5, fillColor: mix(lo, hi, Math.sqrt(v / max)), fillOpacity: 0.85 }; },
        onEachFeature: (f, layer) => { const n = geoComuna(f.properties); layer.bindTooltip(tip(n, values.get(n)), { sticky: true }); },
      }).addTo(m.layer);
    } else {
      for (const [n, ll] of Object.entries(COMUNAS)) {
        const v = values.get(Number(n)) || 0;
        L.circleMarker(ll, {
          radius: 6 + 26 * Math.sqrt(v / max), color: css("--surface"), weight: 1.5,
          fillColor: mix(lo, hi, 0.35 + 0.65 * Math.sqrt(v / max)), fillOpacity: 0.85,
        }).bindTooltip(tip(n, v)).addTo(m.layer);
        L.marker(ll, { icon: L.divIcon({ className: "", html: `<div style="font:600 11px system-ui;color:#0b0b0b;text-shadow:0 0 3px #fff;transform:translate(-50%,-50%);white-space:nowrap">${n}</div>` }), interactive: false }).addTo(m.layer);
      }
    }
    setTimeout(() => m.map.invalidateSize(), 0);
  }
  const comunaNum = (T, rows, idKey) => {
    const c = T.c("comuna");
    const lab = T.d("comuna");
    const numOf = lab.map((s) => { const x = String(s).match(/\d+/); return x ? Number(x[0]) : null; });
    return groupBy(T, rows, (i) => (c[i] >= 0 ? numOf[c[i]] : null), idKey);
  };

  // ───────────────────────── filtros ─────────────────────────
  let openPop = null;
  document.addEventListener("click", (e) => {
    if (openPop && !openPop.wrap.contains(e.target)) { openPop.close(); openPop = null; }
  });

  function filterBar(page, defs) {
    const bar = page.el.querySelector(".filters");
    page.state = {};
    page.widgets = [];
    for (const def of defs) {
      const w = def.type === "date" ? dateFilter(page, def) : multiFilter(page, def);
      page.widgets.push(w);
      bar.appendChild(w.wrap);
    }
    const clear = document.createElement("button");
    clear.className = "ghost clear-all";
    clear.textContent = "Limpiar filtros";
    clear.addEventListener("click", () => { page.state = {}; page.widgets.forEach((w) => w.sync()); page.render(); });
    bar.appendChild(clear);
  }

  function makeWrap(def) {
    const wrap = document.createElement("div");
    wrap.className = "f-wrap";
    wrap.innerHTML = `<button class="f-btn" type="button"><span class="lbl">${esc(def.label)}</span><span class="val">Todos</span></button>`;
    return wrap;
  }

  function multiFilter(page, def) {
    const T = page.T;
    const wrap = makeWrap(def);
    const btn = wrap.firstChild;
    const dict = T.d(def.key) || [];
    const counts = new Array(dict.length).fill(0);
    for (const c of T.c(def.key)) if (c >= 0) counts[c]++;
    const options = dict.map((label, code) => ({ code, label, n: counts[code], q: deacc(label) })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    const LIMIT = 300;
    let pop = null;
    const sel = () => page.state[def.key] || null;
    const changed = debounce(() => page.render(), 200);

    function sync() {
      const s = sel();
      btn.classList.toggle("on", !!(s && s.size));
      btn.querySelector(".val").textContent = !s || !s.size ? "Todos" : s.size === 1 ? dict[[...s][0]] : `${s.size} seleccionados`;
    }
    function paintList(q) {
      const list = pop.querySelector(".list");
      const qq = deacc(q.trim());
      const s = sel();
      let matches = qq ? options.filter((o) => o.q.includes(qq)) : options;
      // Los seleccionados primero
      if (s && s.size) matches = [...matches.filter((o) => s.has(o.code)), ...matches.filter((o) => !s.has(o.code))];
      const shown = matches.slice(0, LIMIT);
      list.innerHTML = shown.map((o) => `<label class="opt"><input type="checkbox" value="${o.code}" ${s && s.has(o.code) ? "checked" : ""}><span>${esc(o.label)}</span><small>${fmt(o.n)}</small></label>`).join("")
        + (matches.length > LIMIT ? `<div class="hint">Mostrando ${fmt(LIMIT)} de ${fmt(matches.length)}. Escribí para buscar.</div>` : "")
        + (!matches.length ? `<div class="hint">Sin coincidencias</div>` : "");
    }
    function open() {
      if (openPop) openPop.close();
      pop = document.createElement("div");
      pop.className = "pop";
      pop.innerHTML = `<input type="search" placeholder="Buscar…"><div class="list"></div><div class="row"><button class="ghost" data-a="clear">Limpiar</button><button class="ghost" data-a="close">Listo</button></div>`;
      wrap.appendChild(pop);
      const input = pop.querySelector("input");
      paintList("");
      input.addEventListener("input", debounce(() => paintList(input.value), 120));
      pop.querySelector(".list").addEventListener("change", (e) => {
        const code = Number(e.target.value);
        const s = new Set(sel() || []);
        e.target.checked ? s.add(code) : s.delete(code);
        if (s.size) page.state[def.key] = s; else delete page.state[def.key];
        sync(); changed();
      });
      pop.querySelector("[data-a=clear]").addEventListener("click", () => { delete page.state[def.key]; sync(); paintList(input.value); changed(); });
      pop.querySelector("[data-a=close]").addEventListener("click", () => close());
      openPop = { wrap, close };
      setTimeout(() => input.focus(), 0);
    }
    function close() { if (pop) { pop.remove(); pop = null; } if (openPop && openPop.wrap === wrap) openPop = null; }
    btn.addEventListener("click", (e) => { e.stopPropagation(); pop ? close() : (open(), (openPop = { wrap, close })); });
    sync();
    return { wrap, sync };
  }

  function dateFilter(page, def) {
    const wrap = makeWrap(def);
    const btn = wrap.firstChild;
    let pop = null;
    const sel = () => page.state[def.key] || null;
    function sync() {
      const s = sel();
      btn.classList.toggle("on", !!s);
      btn.querySelector(".val").textContent = !s ? "Todo el período" : `${s.from != null ? dayStr(s.from) : "…"} – ${s.to != null ? dayStr(s.to) : "…"}`;
    }
    function set(from, to) {
      if (from == null && to == null) delete page.state[def.key];
      else page.state[def.key] = { from, to };
      sync(); page.render();
    }
    function close() { if (pop) { pop.remove(); pop = null; } if (openPop && openPop.wrap === wrap) openPop = null; }
    function open() {
      if (openPop) openPop.close();
      const t = DB.today;
      const d0 = dayDate(t);
      const y = d0.getUTCFullYear(), mo = d0.getUTCMonth();
      const D = (yy, mm, dd) => Math.floor(Date.UTC(yy, mm, dd) / 864e5);
      const presets = [
        ["Hoy", t, t], ["Últimos 7 días", t - 6, t], ["Últimos 30 días", t - 29, t],
        ["Este mes", D(y, mo, 1), t], ["Mes anterior", D(y, mo - 1, 1), D(y, mo, 0)],
        ["Este año", D(y, 0, 1), t], ["Año anterior", D(y - 1, 0, 1), D(y - 1, 11, 31)],
      ];
      const s = sel() || {};
      pop = document.createElement("div");
      pop.className = "pop";
      pop.innerHTML = `<div class="presets">${presets.map((p, i) => `<button class="ghost" data-i="${i}">${p[0]}</button>`).join("")}</div>
        <div class="dates"><label>Desde<input type="date" data-k="from" value="${s.from != null ? dayISO(s.from) : ""}"></label>
        <label>Hasta<input type="date" data-k="to" value="${s.to != null ? dayISO(s.to) : ""}"></label></div>
        <div class="row"><button class="ghost" data-a="clear">Todo el período</button><button class="ghost" data-a="close">Listo</button></div>`;
      wrap.appendChild(pop);
      pop.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => { const p = presets[b.dataset.i]; set(p[1], p[2]); close(); }));
      pop.querySelectorAll("input[type=date]").forEach((inp) => inp.addEventListener("change", () => {
        const from = isoDay(pop.querySelector("[data-k=from]").value);
        const to = isoDay(pop.querySelector("[data-k=to]").value);
        set(from, to);
      }));
      pop.querySelector("[data-a=clear]").addEventListener("click", () => { set(null, null); close(); });
      pop.querySelector("[data-a=close]").addEventListener("click", close);
      openPop = { wrap, close };
    }
    btn.addEventListener("click", (e) => { e.stopPropagation(); pop ? close() : open(); });
    sync();
    return { wrap, sync };
  }

  // Devuelve los índices de filas que cumplen todos los filtros de la página.
  function filteredRows(page) {
    const T = page.T;
    const checks = [];
    for (const def of page.filterDefs) {
      const s = page.state[def.key];
      if (!s) continue;
      const c = T.c(def.key);
      if (def.type === "date") {
        const lo = s.from ?? -Infinity, hi = s.to ?? Infinity;
        checks.push((i) => hasDate(c[i]) && c[i] >= lo && c[i] <= hi);
      } else {
        const mask = new Uint8Array((T.d(def.key) || []).length);
        for (const x of s) mask[x] = 1;
        checks.push((i) => c[i] >= 0 && mask[c[i]] === 1);
      }
    }
    const out = new Int32Array(T.n);
    let k = 0;
    outer: for (let i = 0; i < T.n; i++) {
      for (const f of checks) if (!f(i)) continue outer;
      out[k++] = i;
    }
    return out.subarray(0, k);
  }

  // ───────────────────────── páginas ─────────────────────────
  const kpi = (id, label) => `<div class="kpi"><div class="k-lbl">${esc(label)}</div><div class="k-val" id="${id}">–</div></div>`;
  const card = (cls, title, inner) => `<section class="card ${cls}"><h3>${esc(title)}</h3>${inner}</section>`;
  const canvas = (id, size = "") => `<div class="chart ${size}"><canvas id="${id}"></canvas></div>`;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  const PAGES = [
    {
      id: "medidas", title: "MEDIDAS", table: "M",
      filters: [
        { key: "inicio", label: "Inicio de medida", type: "date" },
        { key: "medida", label: "Medida" },
        { key: "tipo", label: "Tipo de Medida de Protección" },
        { key: "fc", label: "Período (fecha de carga)", type: "date" },
        { key: "comuna", label: "Comuna" },
        { key: "fiscalia", label: "Fiscalía Ordenante" },
        { key: "freg", label: "Fecha registro ASM", type: "date" },
        { key: "unidad", label: "Unidad Fiscal" },
        { key: "depCarga", label: "Dependencia de carga" },
      ],
      layout: (p) => `
        <div class="kpis">${kpi(p + "-k1", "Medidas registradas")}${kpi(p + "-k2", "Medidas MPF")}</div>
        <div class="grid">
          ${card("c12", "Medidas registradas por mes (fecha de carga)", canvas(p + "-mes"))}
          ${card("c5", "Tipo de Medida de Protección", canvas(p + "-tipo"))}
          ${card("c7", "Medidas registradas por Estado", canvas(p + "-estado"))}
          ${card("c6", "Fiscal ordenante por cantidad de medidas registradas", `<div id="${p}-t-fiscal"></div>`)}
          ${card("c6", "Total de medidas por Tipo de Medida de Protección", `<div id="${p}-t-tipo"></div>`)}
          ${card("c7", "Medidas registradas por Comuna", `<div class="map" id="${p}-map"></div>`)}
          ${card("c5", "Total de medidas por Unidad Fiscal", `<div id="${p}-t-unidad"></div>`)}
          ${card("c12", "Total de medidas registradas según Comuna de CABA", canvas(p + "-comuna"))}
        </div>`,
      render(page, T, rows) {
        const p = page.id;
        setText(p + "-k1", fmt(distinct(T, rows, "asm")));
        const org = T.c("origen"), interno = (T.d("origen") || []).indexOf("INTERNO");
        setText(p + "-k2", fmt(distinct(T, rows, "asm", (i) => org[i] === interno)));
        barChart(p + "-mes", monthlySeries(T, rows, "fc", "asm"));
        donutChart(p + "-tipo", catCounts(T, rows, "tipo", "asm"), "M.tipo");
        barChart(p + "-estado", catCounts(T, rows, "estado", "asm"));
        renderTable(p + "-t-fiscal", [{ key: "label", title: "Fiscal / Auxiliar ordenante" }, { key: "value", title: "Medidas registradas", value: true }], catCounts(T, rows, "fiscal", "asm"));
        const tc = T.c("tipo"), mc = T.c("medida");
        const tm = groupBy(T, rows, (i) => (mc[i] >= 0 ? `${tc[i]}|${mc[i]}` : null), "asm");
        renderTable(p + "-t-tipo", [{ key: "tipo", title: "Tipo de Medida" }, { key: "medida", title: "Medida" }, { key: "value", title: "Medidas registradas", value: true }],
          [...tm].map(([k, v]) => { const [a, b] = k.split("|").map(Number); return { tipo: T.label("tipo", a) || "—", medida: T.label("medida", b), value: v }; }).sort((a, b) => b.value - a.value));
        renderMap(p + "-map", comunaNum(T, rows, "asm"), "medidas");
        renderTable(p + "-t-unidad", [{ key: "label", title: "Unidad Fiscal" }, { key: "value", title: "Medidas registradas", value: true }], catCounts(T, rows, "unidad", "asm"));
        barChart(p + "-comuna", catCounts(T, rows, "comuna", "asm"));
      },
    },
    {
      id: "personas", title: "PERSONAS", table: "M",
      filters: [
        { key: "comuna", label: "Comuna" },
        { key: "dest", label: "Nombre destinatario" },
        { key: "notif", label: "¿Se notificó?" },
        { key: "denun", label: "Nombre Denunciado/imputado" },
        { key: "genero", label: "Género" },
        { key: "inicio", label: "Inicio de medida", type: "date" },
        { key: "caracter", label: "En Carácter De" },
        { key: "interv", label: "Intervención OFAVyT/EDID/ANNAVI/AAVPCC" },
      ],
      layout: (p) => `
        <div class="kpis">${kpi(p + "-k1", "Personas únicas")}${kpi(p + "-k2", "Total casos únicos")}${kpi(p + "-k3", "Total personas")}</div>
        <div class="grid">
          ${card("c12", "Total personas por carácter del legajo", canvas(p + "-caracter", "short"))}
          ${card("c12", "Seguimiento del destinatario de la medida según denunciado e inicio de medida", `<div id="${p}-t-seg"></div>`)}
          ${card("c5", "Total de personas por género", canvas(p + "-genero"))}
          ${card("c7", "Total personas por nivel de estudio alcanzado", canvas(p + "-estudio"))}
          ${card("c7", "Total de personas por Comuna", `<div class="map" id="${p}-map"></div>`)}
          ${card("c5", "Total de personas por medida", `<div id="${p}-t-medida"></div>`)}
        </div>`,
      render(page, T, rows) {
        const p = page.id;
        setText(p + "-k1", fmt(distinct(T, rows, "doc")));
        setText(p + "-k2", fmt(distinct(T, rows, "legajo")));
        setText(p + "-k3", fmt(distinct(T, rows, "dest")));
        barChart(p + "-caracter", catCounts(T, rows, "caracter", "dest"));
        const dc = T.c("dest"), nc = T.c("denun"), mc = T.c("medida"), ic = T.c("inicio");
        const seg = groupBy(T, rows, (i) => (dc[i] >= 0 ? `${dc[i]}|${nc[i]}|${mc[i]}|${ic[i]}` : null), "legajo");
        renderTable(p + "-t-seg", [
          { key: "dest", title: "Nombre destinatario" }, { key: "denun", title: "Nombre Denunciado/imputado" },
          { key: "medida", title: "Medida" }, { key: "inicio", title: "Inicio de medida", format: (d) => (hasDate(d) ? dayStr(d) : "—") },
          { key: "value", title: "Total casos únicos", value: true },
        ], [...seg].map(([k, v]) => { const [a, b, c, d] = k.split("|").map(Number); return { dest: T.label("dest", a), denun: T.label("denun", b) || "—", medida: T.label("medida", c) || "—", inicio: d, value: v }; })
          .sort((a, b) => b.value - a.value || b.inicio - a.inicio), { pageSize: 12 });
        donutChart(p + "-genero", catCounts(T, rows, "genero", "dest"), "M.genero");
        barChart(p + "-estudio", catCounts(T, rows, "estudio", "dest"), { horizontal: true });
        renderMap(p + "-map", comunaNum(T, rows, "dest"), "personas");
        renderTable(p + "-t-medida", [{ key: "label", title: "Medida" }, { key: "value", title: "Total personas", value: true }], catCounts(T, rows, "medida", "dest"), { pageSize: 13 });
      },
    },
    {
      id: "casos", title: "CASOS", table: "M",
      filters: [
        { key: "fc", label: "Período (fecha de carga)", type: "date" },
        { key: "unidad", label: "Unidad Fiscal" },
        { key: "depResp", label: "Dependencia Responsable" },
        { key: "fiscal", label: "Fiscal / Auxiliar ordenante" },
        { key: "fiscalia", label: "Fiscalía Ordenante" },
        { key: "depCarga", label: "Dependencia de carga" },
      ],
      layout: (p) => `
        <div class="kpis">${kpi(p + "-k1", "Medidas registradas")}${kpi(p + "-k2", "Total casos únicos")}</div>
        <div class="grid">
          ${card("c6", "Total casos únicos por Unidad Fiscal", canvas(p + "-unidad"))}
          ${card("c6", "Total de casos por Fiscalía ordenante", `<div id="${p}-t-fiscalia"></div>`)}
          ${card("c12", "Top 5 Fiscalías Ordenantes por total de casos únicos", canvas(p + "-top5"))}
        </div>`,
      render(page, T, rows) {
        const p = page.id;
        setText(p + "-k1", fmt(distinct(T, rows, "asm")));
        setText(p + "-k2", fmt(distinct(T, rows, "legajo")));
        barChart(p + "-unidad", catCounts(T, rows, "unidad", "legajo"), { horizontal: true });
        const fis = catCounts(T, rows, "fiscalia", "legajo");
        renderTable(p + "-t-fiscalia", [{ key: "label", title: "Fiscalía Ordenante" }, { key: "value", title: "Total casos únicos", value: true }], fis, { pageSize: 10 });
        barChart(p + "-top5", fis.slice(0, 5));
      },
    },
    {
      id: "gestion", title: "GESTIÓN", table: "M",
      filters: [
        { key: "medida", label: "Medida" },
        { key: "legajo", label: "Legajo Relacionado" },
        { key: "agente", label: "Agente" },
        { key: "fc", label: "Fecha de carga", type: "date" },
      ],
      layout: (p) => `
        <div class="kpis">
          ${kpi(p + "-k1", "Medidas registradas")}${kpi(p + "-k2", "Medidas gestionadas hoy")}
          <div class="kpi gauge"><div class="k-lbl">Porcentaje de medidas gestionadas</div><canvas id="${p}-gauge"></canvas><div class="k-val" id="${p}-k3">–</div></div>
          ${kpi(p + "-k4", "Total medidas gestionadas")}${kpi(p + "-k5", "Promedio medidas x agente")}
          ${kpi(p + "-k6", "Promedio de gestión diaria")}${kpi(p + "-k7", "Promedio gestión semanal")}${kpi(p + "-k8", "Promedio gestión mensual")}
        </div>
        <div class="grid">
          ${card("c12", "Total medidas gestionadas por fecha de carga (año y mes)", canvas(p + "-mes"))}
          ${card("c12", "Total de tipos de gestión por agente", canvas(p + "-tipos", "tall"))}
          ${card("c12", "Total medidas gestionadas por agente", canvas(p + "-agente"))}
        </div>`,
      render(page, T, rows) {
        const p = page.id;
        const fc = T.c("fc");
        const asmC = T.c("asm");
        // Gestionada = tiene Nro ASM y Fecha de carga (misma regla que la planilla).
        const gest = rows.filter((i) => hasDate(fc[i]) && asmC[i] >= 0);
        const reg = distinct(T, rows, "asm");
        const gUniq = distinct(T, gest, "asm");
        setText(p + "-k1", fmt(reg));
        setText(p + "-k2", fmt(distinct(T, gest, "asm", (i) => fc[i] === DB.today)));
        const ratio = reg ? gest.length / reg : 0;
        setText(p + "-k3", `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(ratio * 100)} %`);
        gaugeChart(p + "-gauge", ratio);
        setText(p + "-k4", fmt(gest.length));
        const ag = distinct(T, gest, "agente");
        setText(p + "-k5", ag ? fmt(gUniq / ag) : "–");
        const days = new Set(), weeks = new Set(), months = new Set();
        for (const i of gest) { days.add(fc[i]); weeks.add(weekKey(fc[i])); months.add(monthKey(fc[i])); }
        setText(p + "-k6", days.size ? fmt(gUniq / days.size) : "–");
        setText(p + "-k7", weeks.size ? fmt(gUniq / weeks.size) : "–");
        setText(p + "-k8", months.size ? fmt(gUniq / months.size) : "–");
        barChart(p + "-mes", monthlySeries(T, gest, "fc", "asm"));

        // Tipos de gestión: se suman Acc. Gest. 1, 2 y 3 de cada fila gestionada.
        const agentes = catCounts(T, gest, "agente", null).slice(0, 10);
        const agIdx = new Map(agentes.map((a, j) => [a.label, j]));
        const agc = T.c("agente");
        const counts = new Map(); // tipo → array por agente
        const totals = new Map();
        for (const key of ["g1", "g2", "g3"]) {
          const c = T.c(key), d = T.d(key);
          for (const i of gest) {
            if (c[i] < 0 || agc[i] < 0) continue;
            const j = agIdx.get(T.label("agente", agc[i]));
            if (j === undefined) continue;
            const tipo = d[c[i]];
            if (!counts.has(tipo)) counts.set(tipo, new Array(agentes.length).fill(0));
            counts.get(tipo)[j]++;
            totals.set(tipo, (totals.get(tipo) || 0) + 1);
          }
        }
        const ranked = colorRank["M.gest"] || [];
        const keep = ranked.slice(0, 7).filter((t) => counts.has(t));
        const other = new Array(agentes.length).fill(0);
        for (const [t, arr] of counts) if (!keep.includes(t)) arr.forEach((v, j) => (other[j] += v));
        const ds = keep.map((t) => ({ label: t, data: counts.get(t), backgroundColor: colorFor("M.gest", t) }));
        if (other.some((v) => v)) ds.push({ label: "Otros", data: other, backgroundColor: css("--other") });
        stackedChart(p + "-tipos", agentes.map((a) => a.label), ds);
        barChart(p + "-agente", catCounts(T, gest, "agente", null).slice(0, 15));
      },
    },
    {
      id: "alertas", title: "ALERTAS", table: "A",
      filters: [],
      layout: (p) => `
        <div class="error" id="${p}-warn" style="display:none;margin-bottom:16px"></div>
        <div class="grid">
          ${card("c5", "Tipos de medidas por casos", canvas(p + "-tmedida"))}
          ${card("c7", "Cantidad de casos por gestión", canvas(p + "-gestion"))}
          ${card("c5", "Distribución de casos por tipo de alerta", canvas(p + "-talerta"))}
          ${card("c7", "Casos por Estado S/M", canvas(p + "-estado"))}
        </div>`,
      render(page, T, rows) {
        const p = page.id;
        const warn = document.getElementById(p + "-warn");
        const reason = DB.alertasError || (T.n === 0 ? "La hoja de Alertas llegó vacía." : (DB.missingA.length ? `Columnas no encontradas: ${DB.missingA.join(", ")}` : ""));
        warn.style.display = reason ? "block" : "none";
        warn.innerHTML = reason ? `<b>No se pudieron leer las alertas.</b><br>${esc(reason)}` : "";
        // Igual que el Looker: se cuentan registros; en la torta los vacíos suman a "Otros".
        const tm = catCounts(T, rows, "tmedida", null);
        const blanks = rows.length - tm.reduce((s, x) => s + x.value, 0);
        const pie = topN(tm, 3);
        if (blanks > 0) {
          const o = pie.find((x) => x.label === "Otros");
          o ? (o.value += blanks) : pie.push({ label: "Otros", value: blanks, other: true });
        }
        donutChart(p + "-tmedida", pie, "A.tmedida");
        barChart(p + "-gestion", catCounts(T, rows, "gestion", null));
        barChart(p + "-talerta", catCounts(T, rows, "talerta", null));
        barChart(p + "-estado", catCounts(T, rows, "estadoSM", null), { horizontal: true });
      },
    },
  ];

  // ───────────────────────── arranque ─────────────────────────
  function buildRanks() {
    const M = DB.M, A = DB.A;
    const all = (T) => { const r = new Int32Array(T.n); for (let i = 0; i < T.n; i++) r[i] = i; return r; };
    const rm = all(M), ra = all(A);
    colorRank["M.tipo"] = catCounts(M, rm, "tipo", "asm").map((x) => x.label);
    colorRank["M.genero"] = ["FEMENINO", "MASCULINO", "Otros"];
    colorRank["A.tmedida"] = catCounts(A, ra, "tmedida", null).map((x) => x.label);
    const tot = new Map();
    for (const key of ["g1", "g2", "g3"]) for (const x of catCounts(M, rm, key, null)) tot.set(x.label, (tot.get(x.label) || 0) + x.value);
    colorRank["M.gest"] = [...tot].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }

  function mount() {
    const app = $("#app");
    const tabs = $("#tabs");
    app.innerHTML = "";
    tabs.innerHTML = "";
    for (const def of PAGES) {
      const el = document.createElement("div");
      el.className = "page";
      el.id = "page-" + def.id;
      el.innerHTML = `${def.filters.length ? `<div class="filters"></div>` : ""}${def.layout(def.id)}`;
      app.appendChild(el);
      const page = { ...def, el, T: DB[def.table], filterDefs: def.filters, dirty: true };
      page.render = () => {
        if (!el.classList.contains("active")) { page.dirty = true; return; }
        page.dirty = false;
        def.render(page, page.T, filteredRows(page));
      };
      if (def.filters.length) filterBar(page, def.filters);
      def.page = page;
      const b = document.createElement("button");
      b.textContent = def.title;
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => show(def.id));
      tabs.appendChild(b);
    }
    const start = (location.hash || "").slice(1);
    show(PAGES.some((p) => p.id === start) ? start : "medidas");
  }

  function show(id) {
    for (const def of PAGES) {
      const on = def.id === id;
      def.page.el.classList.toggle("active", on);
      [...$("#tabs").children][PAGES.indexOf(def)].setAttribute("aria-selected", on);
    }
    history.replaceState(null, "", "#" + id);
    const page = PAGES.find((p) => p.id === id).page;
    if (page.dirty) page.render();
    Object.values(maps).forEach((m) => setTimeout(() => m.map.invalidateSize(), 50));
  }

  async function load() {
    const res = await fetch("api/data", { cache: "no-store" });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  async function init() {
    setChartDefaults();
    try {
      const raw = window.__DATA__ || (await load());
      if (raw.naDate !== undefined) NA = raw.naDate;
      DB = { M: wrap(raw.medidas), A: wrap(raw.alertas), today: raw.today, alertasError: raw.alertasError, missingA: raw.missing?.alertas || [] };
      const missing = raw.missing?.medidas || [];
      const when = new Date(raw.generatedAt);
      $("#updated").textContent = `Datos al ${when.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}`
        + (missing.length ? ` · Columnas no encontradas: ${missing.join(", ")}` : "");
      buildRanks();
      mount();
    } catch (err) {
      $("#app").innerHTML = `<div class="error"><b>No se pudieron cargar los datos.</b><br>${esc(err.message)}</div>`;
      $("#updated").textContent = "";
    }
  }

  $("#reload").addEventListener("click", () => location.reload());
  init();
})();
