/* Congreso Abierto Perú — dashboard multi-sección sobre data.json + context.json. */

const fmt = (n) => new Intl.NumberFormat("es-PE").format(n);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let CHARTS = {};
let DATA = null, CTX = null, PERSONAL = null;
const soles = (n) => "S/ " + new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(n);
const solesM = (n) => "S/ " + (n / 1e6).toFixed(1) + " M";

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

const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

function renderPersonal() {
  if (!PERSONAL) return; // snapshot del PTE opcional; si falta, no rompe el resto
  const P = PERSONAL, t = P.totales, s = P.sueldos, m = P.meta;

  const badge = document.getElementById("per-badge");
  if (badge) badge.textContent = `✅ Planilla nominal real · Portal de Transparencia (PTE) · ${MESES[m.mes]} ${m.anio}`;

  document.getElementById("kpis-per").innerHTML =
    kpiCard("Planilla activa", fmt(t.planilla_activa), "personas (CAS + 276 + 728)", "var(--accent)") +
    kpiCard("Masa salarial", solesM(t.masa_mensual_activa), "al mes · planilla activa", "var(--amber)") +
    kpiCard("Costo anual est.", solesM(t.masa_anual_activa_est), "≈ 14 sueldos (2 gratif.)", "var(--accent-2)") +
    kpiCard("Sueldo mediana", soles(s.mediana), `máx. ${soles(s.max)}`, "var(--purple)");

  // Personal por régimen
  const reg = P.por_regimen;
  mk("chPerReg", {
    type: "bar",
    data: { labels: reg.map(r => r.regimen), datasets: [{ data: reg.map(r => r.n), backgroundColor: palette(reg.length), borderRadius: 6 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.x)} personas · ${solesM(reg[c.dataIndex].masa)}/mes` } } }, scales: scales(true) }),
  });

  // Distribución de sueldos
  const d = s.distribucion;
  mk("chPerDist", {
    type: "bar",
    data: { labels: d.map(x => x.rango), datasets: [{ data: d.map(x => x.n), backgroundColor: css("--green"), borderRadius: 6 }] },
    options: opts({ plugins: { legend: { display: false } }, scales: scales(false) }),
  });

  // Personal por cargo
  const cg = P.por_cargo;
  mk("chPerCargo", {
    type: "bar",
    data: { labels: cg.map(c => c.cargo), datasets: [{ data: cg.map(c => c.n), backgroundColor: css("--accent-2"), borderRadius: 6 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  });

  // Top sueldos
  document.querySelector("#tPerTop tbody").innerHTML = P.top_sueldos.map(r =>
    `<tr><td>${r.nombre}</td><td>${r.cargo}</td><td style="text-align:right;white-space:nowrap"><b>${soles(r.total)}</b></td></tr>`).join("");

  // Top pensiones
  document.querySelector("#tPerPen tbody").innerHTML = P.top_pensiones.map(r =>
    `<tr><td>${r.nombre}</td><td>${r.cargo}</td><td style="text-align:right;white-space:nowrap"><b>${soles(r.total)}</b></td></tr>`).join("");

  const bulk = reg.find(r => /728/.test(r.regimen));
  document.getElementById("per-facts").innerHTML = [
    `La planilla activa suma <b>${fmt(t.planilla_activa)} personas</b> y cuesta <b>${soles(t.masa_mensual_activa)} al mes</b> (≈ <b>${soles(t.masa_anual_activa_est)}</b> al año con gratificaciones).`,
    bulk ? `El grueso está en el <b>Régimen 728</b>: ${fmt(bulk.n)} personas y ${solesM(bulk.masa)} mensuales.` : "",
    `El sueldo mediano es <b>${soles(s.mediana)}</b> y el más alto <b>${soles(s.max)}</b> (${P.top_sueldos[0]?.cargo || "—"}).`,
    `Aparte, <b>${fmt(t.pensionistas)} pensionistas</b> (cesantes, viudez y ex-presidentes) cuestan <b>${soles(t.masa_mensual_pensiones)}</b> al mes.`,
  ].filter(Boolean).map(x => `<li>${x}</li>`).join("");

  document.getElementById("per-fuentes").innerHTML =
    `Fuente: <a href="https://www.transparencia.gob.pe/personal/pte_transparencia_personal.aspx?id_entidad=16" target="_blank" rel="noopener">Portal de Transparencia Estándar (PTE)</a> — planilla nominal del Congreso (id_entidad=16), ${MESES[m.mes]} ${m.anio}. ${m.nota}`;

  initBuscadorPersonal();
}

// ---- Buscador de personal (directorio nominal completo) ----
const PER_PAGE = 50;
let perState = { q: "", reg: "", orden: "nombre", pag: 0, wired: false };

function personalFiltrado() {
  const L = PERSONAL.lista || [];              // [nombre, cargo, regimen, dependencia, total]
  const q = perState.q.trim().toLowerCase();
  const reg = perState.reg;
  let out = L.filter(r =>
    (!reg || r[2] === reg) &&
    (!q || (r[0] + " " + r[1] + " " + r[3]).toLowerCase().includes(q))
  );
  out = out.slice().sort(perState.orden === "sueldo"
    ? (a, b) => b[4] - a[4]
    : (a, b) => a[0].localeCompare(b[0], "es"));
  return out;
}

function renderBuscadorPersonal() {
  const res = personalFiltrado();
  const total = res.length;
  const paginas = Math.max(1, Math.ceil(total / PER_PAGE));
  if (perState.pag >= paginas) perState.pag = paginas - 1;
  if (perState.pag < 0) perState.pag = 0;
  const slice = res.slice(perState.pag * PER_PAGE, perState.pag * PER_PAGE + PER_PAGE);

  document.getElementById("per-count").textContent =
    `${fmt(total)} ${total === 1 ? "persona" : "personas"}`;
  document.querySelector("#tPerLista tbody").innerHTML = slice.map(r =>
    `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[3] || "—"}</td><td>${r[2]}</td><td>${soles(r[4])}</td></tr>`
  ).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">Sin resultados para “${perState.q}”.</td></tr>`;

  document.getElementById("per-pag").textContent = `Página ${perState.pag + 1} de ${fmt(paginas)}`;
  document.getElementById("per-prev").disabled = perState.pag === 0;
  document.getElementById("per-next").disabled = perState.pag >= paginas - 1;
}

function initBuscadorPersonal() {
  // poblar filtro de régimen una sola vez con lo que hay en los datos
  const sel = document.getElementById("per-reg");
  if (sel && sel.options.length <= 1) {
    (PERSONAL.por_regimen || []).forEach(r => {
      const o = document.createElement("option");
      o.value = r.regimen; o.textContent = `${r.regimen} (${fmt(r.n)})`;
      sel.appendChild(o);
    });
  }
  if (perState.wired) { renderBuscadorPersonal(); return; }
  perState.wired = true;
  const q = document.getElementById("per-q");
  q.addEventListener("input", () => { perState.q = q.value; perState.pag = 0; renderBuscadorPersonal(); });
  sel.addEventListener("change", () => { perState.reg = sel.value; perState.pag = 0; renderBuscadorPersonal(); });
  document.getElementById("per-orden").addEventListener("change", e => { perState.orden = e.target.value; perState.pag = 0; renderBuscadorPersonal(); });
  document.getElementById("per-prev").addEventListener("click", () => { perState.pag--; renderBuscadorPersonal(); });
  document.getElementById("per-next").addEventListener("click", () => { perState.pag++; renderBuscadorPersonal(); });
  renderBuscadorPersonal();
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

Promise.all([
  fetch("data.json").then(r => r.json()),
  fetch("context.json").then(r => r.json()),
  fetch("personal.json").then(r => r.ok ? r.json() : null).catch(() => null),
])
  .then(([d, c, p]) => {
    DATA = d; CTX = c; PERSONAL = p;
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
