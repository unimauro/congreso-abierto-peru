/* Congreso Abierto Perú — dashboard multi-sección sobre data.json + context.json. */

const fmt = (n) => new Intl.NumberFormat("es-PE").format(n);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let CHARTS = {};
let DATA = null, CTX = null;

function palette(n) {
  const base = ["#e23744", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7",
    "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#6366f1", "#eab308"];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}
const gridC = () => css("--border");
const textC = () => css("--muted");

function opts(extra = {}) {
  return Object.assign({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: textC(), font: { family: "Inter", size: 12 } } },
      tooltip: { backgroundColor: "#000", padding: 10, cornerRadius: 8 },
    },
  }, extra);
}
function scales(h = false) {
  const ax = { grid: { color: gridC() }, ticks: { color: textC(), font: { family: "Inter", size: 11 } }, border: { display: false } };
  return h ? { x: ax, y: Object.assign({}, ax, { grid: { display: false } }) }
           : { y: ax, x: Object.assign({}, ax, { grid: { display: false } }) };
}
function mk(id, cfg) {
  if (CHARTS[id]) CHARTS[id].destroy();
  const el = document.getElementById(id);
  if (el) CHARTS[id] = new Chart(el, cfg);
}
function kpiCard(label, num, meta, color) {
  return `<div class="card kpi"><div class="label">${label}</div>
    <div class="num"${color ? ` style="color:${color}"` : ""}>${num}</div>
    <div class="meta">${meta || ""}</div></div>`;
}

function renderResumen() {
  const t = DATA.totales;
  const tasa = (t.leyes_aprobadas / t.proyectos * 100).toFixed(1);
  const pres = CTX.presupuesto.serie.at(-1);
  document.getElementById("kpis-resumen").innerHTML =
    kpiCard("Proyectos de ley", fmt(t.proyectos), "presentados 2021–26") +
    kpiCard("Leyes publicadas", fmt(t.leyes_aprobadas), `<b>${tasa}%</b> de aprobación`, "var(--green)") +
    kpiCard("Autores activos", fmt(t.autores_unicos), "congresistas firmantes", "var(--amber)") +
    kpiCard(`Presupuesto ${pres.anio}`, `S/ ${fmt(pres.pia)} M`, "PIA del Congreso", "var(--accent)");

  mk("chAnio", {
    type: "bar",
    data: { labels: Object.keys(DATA.por_anio), datasets: [{ data: Object.values(DATA.por_anio), backgroundColor: css("--accent"), borderRadius: 6, maxBarThickness: 60 }] },
    options: opts({ plugins: { legend: { display: false } }, scales: scales() }),
  });
  const s = CTX.presupuesto.serie;
  mk("chPresMini", {
    type: "line",
    data: { labels: s.map(x => x.anio), datasets: [{ data: s.map(x => x.pia), borderColor: css("--accent"), backgroundColor: "rgba(226,55,68,.15)", fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: css("--accent") }] },
    options: opts({ plugins: { legend: { display: false } }, scales: scales() }),
  });
  renderYearFilter();
}

// --- Filtro de año dinámico ---
let SELYEAR = null;
function aniosDisponibles() {
  const pres = CTX.presupuesto.serie.map(x => x.anio);
  const proy = Object.keys(DATA.por_anio).map(Number);
  // años donde hay datos legislativos (periodo actual) y presupuesto
  return pres.filter(a => proy.includes(a)).sort((a, b) => a - b);
}
function renderYearFilter() {
  const years = aniosDisponibles();
  if (!years.length) return;
  if (!SELYEAR || !years.includes(SELYEAR)) SELYEAR = years[years.length - 1];
  const bar = document.getElementById("yearbar");
  bar.querySelectorAll(".ychip").forEach(c => c.remove());
  years.forEach(y => {
    const b = document.createElement("button");
    b.className = "ychip" + (y === SELYEAR ? " active" : "");
    b.textContent = y;
    b.onclick = () => { SELYEAR = y; renderYearFilter(); };
    bar.appendChild(b);
  });
  renderYearKpis(SELYEAR);
}
function renderYearKpis(y) {
  const proy = DATA.por_anio[y] || 0;
  const pb = CTX.presupuesto.serie.find(x => x.anio === y) || {};
  const fmtM = (m) => m != null ? `S/ ${fmt(m)} M` : "—";
  document.getElementById("kpis-year").innerHTML =
    kpiCard("Proyectos presentados", fmt(proy), `en ${y}`, "var(--accent)") +
    kpiCard("Presupuesto (PIM)", fmtM(pb.pim), `modificado ${y}`, "var(--accent-2)") +
    kpiCard("Ejecutado (Devengado)", fmtM(pb.devengado), `gastado en ${y}`, "var(--green)") +
    kpiCard("Avance de ejecución", pb.avance != null ? `${pb.avance}%` : "—", "devengado / PIM", "var(--amber)");
}

function renderProyectos() {
  mk("chEstado", {
    type: "bar",
    data: { labels: Object.keys(DATA.por_estado), datasets: [{ data: Object.values(DATA.por_estado), backgroundColor: css("--accent-2"), borderRadius: 6 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  });
  const aut = DATA.top_autores.slice(0, 14);
  mk("chAutor", {
    type: "bar",
    data: { labels: aut.map(a => a.nombre), datasets: [{ data: aut.map(a => a.proyectos), backgroundColor: css("--green"), borderRadius: 6 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  });
  const pL = Object.keys(DATA.por_proponente), pV = Object.values(DATA.por_proponente);
  mk("chProp", {
    type: "doughnut",
    data: { labels: pL, datasets: [{ data: pV, backgroundColor: palette(pL.length), borderWidth: 0 }] },
    options: opts({ cutout: "62%", plugins: { legend: { position: "bottom", labels: { color: textC(), boxWidth: 12, font: { size: 11 } } } } }),
  });
  document.querySelector("#tabla tbody").innerHTML = DATA.recientes.slice(0, 12).map(p => {
    const ley = /PUBLICAD|PROMULGAD|AUTÓGRAFA|AUTOGRAFA/i.test(p.estado);
    return `<tr><td class="code">${p.codigo}</td>
      <td>${(p.titulo.charAt(0) + p.titulo.slice(1).toLowerCase()).slice(0, 90)}…</td>
      <td><span class="tag ${ley ? "ley" : ""}">${p.estado}</span></td></tr>`;
  }).join("");
}

function fuentesHtml(arr) {
  return "Fuentes: " + arr.map(f => `<a href="${f.url}" target="_blank" rel="noopener">${f.medio}</a>`).join(" · ");
}

function renderPresupuesto() {
  const p = CTX.presupuesto, s = p.serie;
  const first = s[0], last = s.at(-1);
  const crec = ((last.pia / first.pia - 1) * 100).toFixed(0);
  document.getElementById("pres-unidad").textContent = p.unidad + " · PIA vs Devengado";
  document.getElementById("kpis-pres").innerHTML =
    kpiCard(`PIA ${last.anio}`, `S/ ${fmt(last.pia)} M`, "presupuesto de apertura", "var(--accent)") +
    kpiCard(`Devengado ${last.anio}`, `S/ ${fmt(last.devengado)} M`, `${last.avance}% de avance`, "var(--green)") +
    kpiCard(`Crecimiento ${first.anio}–${last.anio}`, `+${crec}%`, "PIA en el periodo", "var(--amber)") +
    kpiCard("Por congresista", `S/ ${(last.pia / 130).toFixed(1)} M`, "PIA ÷ 130 congresistas", "var(--purple)");
  mk("chPres", {
    type: "bar",
    data: {
      labels: s.map(x => x.anio),
      datasets: [
        { label: "PIA", data: s.map(x => x.pia), backgroundColor: css("--accent"), borderRadius: 6, maxBarThickness: 46 },
        { label: "Devengado (ejecutado)", data: s.map(x => x.devengado), backgroundColor: css("--green"), borderRadius: 6, maxBarThickness: 46 },
        { label: "Avance %", type: "line", data: s.map(x => x.avance), borderColor: css("--amber"), backgroundColor: css("--amber"), tension: .3, pointRadius: 3, yAxisID: "y2" },
      ],
    },
    options: opts({
      plugins: { legend: { labels: { color: textC() } } },
      scales: Object.assign(scales(), {
        y2: { position: "right", min: 0, max: 100, grid: { display: false }, ticks: { color: textC(), callback: v => v + "%", font: { size: 11 } }, border: { display: false } },
      }),
    }),
  });
  document.getElementById("pres-facts").innerHTML = p.destacados.map(d => `<li>${d}</li>`).join("");
  document.getElementById("pres-fuentes").innerHTML = fuentesHtml(p.fuentes);
}

function renderComisiones() {
  const com = DATA.comisiones.filter(c => c.proyectos > 0);
  const total = com.reduce((a, c) => a + c.proyectos, 0);
  document.getElementById("kpis-com").innerHTML =
    kpiCard("Comisiones activas", fmt(com.length), "con proyectos asignados", "var(--accent-2)") +
    kpiCard("Comisión más cargada", com[0]?.nombre.split(" ").slice(0, 2).join(" ") || "—", `${fmt(com[0]?.proyectos || 0)} proyectos`, "var(--accent)") +
    kpiCard("Proyectos asignados", fmt(total), "suma entre comisiones") +
    kpiCard("Promedio", fmt(Math.round(total / (com.length || 1))), "proyectos por comisión", "var(--amber)");
  const top = com.slice(0, 15);
  mk("chCom", {
    type: "bar",
    data: { labels: top.map(c => c.nombre), datasets: [{ data: top.map(c => c.proyectos), backgroundColor: css("--accent-2"), borderRadius: 6 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  });
}

function renderPersonal() {
  const pe = CTX.personal;
  document.getElementById("kpis-per").innerHTML =
    pe.kpis.map((k, i) => kpiCard(k.label, k.valor, k.nota, i === 0 ? "var(--accent)" : "var(--amber)")).join("") +
    kpiCard("Despacho base", "7", "máx. por congresista", "var(--green)") +
    kpiCard("Si preside comisión", "17", "máx. a gestionar", "var(--purple)");
  mk("chPer", {
    type: "bar",
    data: { labels: pe.estructura.map(e => e.item), datasets: [{ data: pe.estructura.map(e => e.max), backgroundColor: [css("--green"), css("--purple")], borderRadius: 6 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  });
  document.getElementById("per-facts").innerHTML = pe.destacados.map(d => `<li>${d}</li>`).join("");
  document.getElementById("per-fuentes").innerHTML = fuentesHtml(pe.fuentes);
}

function renderIncremento() {
  const inc = CTX.incremento;
  if (!inc) return;
  document.getElementById("inc-titulo").textContent = inc.titulo;
  mk("chIncremento", {
    type: "doughnut",
    data: { labels: inc.motivos.map(m => m.factor), datasets: [{ data: inc.motivos.map(m => m.peso), backgroundColor: palette(inc.motivos.length), borderWidth: 0 }] },
    options: opts({ cutout: "58%", plugins: { legend: { position: "bottom", labels: { color: textC(), boxWidth: 12, font: { size: 11 } } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed}%` } } } }),
  });
  document.getElementById("inc-facts").innerHTML = inc.motivos.map(m => `<li><b>${m.factor} (${m.peso}%)</b> — ${m.detalle}</li>`).join("");
  document.getElementById("inc-fuentes").innerHTML = fuentesHtml(inc.fuentes);
}

function renderAnalisis() {
  const prod = DATA.produccion_congresistas || [];
  const c = DATA.concentracion || {};
  document.getElementById("kpis-analisis").innerHTML =
    kpiCard("Autores principales", fmt(c.autores_principales || 0), "congresistas que lideran proyectos", "var(--accent)") +
    kpiCard("Top 10 concentra", `${c.top10_pct || 0}%`, "de todos los proyectos", "var(--amber)") +
    kpiCard("Top 20 concentra", `${c.top20_pct || 0}%`, "de todos los proyectos", "var(--accent-2)") +
    kpiCard("Líder", prod[0]?.nombre.split(",")[0] || "—", `${fmt(prod[0]?.proyectos || 0)} proyectos`, "var(--purple)");
  const top = prod.slice(0, 15);
  mk("chProd", {
    type: "bar",
    data: { labels: top.map(x => x.nombre), datasets: [{ data: top.map(x => x.proyectos), backgroundColor: css("--accent"), borderRadius: 6 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  });
  document.getElementById("prod-note").innerHTML =
    `Se cuenta como <b>autor principal</b> al primer firmante de cada proyecto. ${fmt(c.autores_principales || 0)} congresistas lideraron al menos un proyecto; los 10 más activos concentran el <b>${c.top10_pct || 0}%</b> de toda la producción legislativa del periodo.`;
}

function renderAll() {
  if (!DATA || !CTX) return;
  renderResumen(); renderProyectos(); renderPresupuesto(); renderIncremento();
  renderComisiones(); renderAnalisis(); renderPersonal();
}

Promise.all([fetch("data.json").then(r => r.json()), fetch("context.json").then(r => r.json())])
  .then(([d, c]) => {
    DATA = d; CTX = c;
    document.getElementById("gen").textContent = "actualizado " + d.meta.generado;
    const ud = document.getElementById("updated-date");
    if (ud) ud.textContent = d.meta.generado;
    renderAll();
  })
  .catch(e => { document.getElementById("kpis-resumen").innerHTML = `<div class="card">Error cargando datos: ${e}</div>`; });

// Menú + navegación por hash (#presupuesto, #comisiones, …)
function activar(view, scroll = true) {
  const btn = document.querySelector(`.menu button[data-view="${view}"]`);
  if (!btn) return;
  document.querySelectorAll(".menu button").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("view-" + view).classList.add("active");
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll(".menu button").forEach(btn => {
  btn.addEventListener("click", () => { location.hash = btn.dataset.view; activar(btn.dataset.view); });
});
const initial = (location.hash || "").replace("#", "");
if (initial) activar(initial, false);

// Modal Yape
const yModal = document.getElementById("yape-modal");
document.getElementById("yape-top").addEventListener("click", () => yModal.classList.add("open"));
document.getElementById("yape-close").addEventListener("click", () => yModal.classList.remove("open"));
yModal.addEventListener("click", (e) => { if (e.target === yModal) yModal.classList.remove("open"); });

// Tema
const themeBtn = document.getElementById("theme");
const saved = localStorage.getItem("cap-theme");
if (saved) document.documentElement.setAttribute("data-theme", saved);
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("cap-theme", next);
  renderAll();
});
