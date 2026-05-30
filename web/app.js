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
  document.getElementById("pres-unidad").textContent = p.unidad;
  document.getElementById("kpis-pres").innerHTML =
    kpiCard(`PIA ${last.anio}`, `S/ ${fmt(last.pia)} M`, "presupuesto vigente", "var(--accent)") +
    kpiCard(`PIA ${first.anio}`, `S/ ${fmt(first.pia)} M`, "punto de partida") +
    kpiCard(`Crecimiento ${first.anio}–${last.anio}`, `+${crec}%`, "aumento del costo", "var(--amber)") +
    kpiCard("Por congresista", `S/ ${(last.pia / 130).toFixed(1)} M`, "PIA ÷ 130 congresistas", "var(--purple)");
  mk("chPres", {
    type: "bar",
    data: { labels: s.map(x => x.anio), datasets: [{ label: "PIA (millones S/)", data: s.map(x => x.pia), backgroundColor: css("--accent"), borderRadius: 8, maxBarThickness: 90 }] },
    options: opts({ plugins: { legend: { display: false } }, scales: scales() }),
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

function renderAll() {
  if (!DATA || !CTX) return;
  renderResumen(); renderProyectos(); renderPresupuesto(); renderComisiones(); renderPersonal();
}

Promise.all([fetch("data.json").then(r => r.json()), fetch("context.json").then(r => r.json())])
  .then(([d, c]) => {
    DATA = d; CTX = c;
    document.getElementById("gen").textContent = "actualizado " + d.meta.generado;
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
