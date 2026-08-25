/* Congreso Abierto Perú — dashboard multi-sección sobre data.json + context.json. */

const fmt = (n) => new Intl.NumberFormat("es-PE").format(n);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let CHARTS = {};
let DATA = null, CTX = null, PERSONAL = null;
const soles = (n) => "S/ " + new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(n);
const solesM = (n) => "S/ " + (n / 1e6).toFixed(1) + " M";

// Paleta categórica fija (≤5 series; las demás se pliegan en "Otros").
// Validada por tema (CVD ΔE, banda de luminosidad y contraste sobre la superficie).
function palette(n) {
  const light = document.documentElement.getAttribute("data-theme") === "light";
  const base = light
    ? ["#e23744", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4"]
    : ["#e23744", "#3b82f6", "#d97706", "#a855f7", "#0891b2"];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}
// Pliega un objeto {label: valor} a los top-k + "Otros" (para tortas legibles).
function foldTop(obj, k = 4) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, k), resto = entries.slice(k);
  if (resto.length) top.push(["Otros (" + resto.length + ")", resto.reduce((a, e) => a + e[1], 0)]);
  return { labels: top.map(e => e[0]), values: top.map(e => e[1]) };
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
    data: { labels: Object.keys(DATA.por_anio), datasets: [{ data: Object.values(DATA.por_anio), backgroundColor: css("--accent"), borderRadius: 4, maxBarThickness: 60 }] },
    options: opts({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y)} proyectos` } } }, scales: scales() }),
  });
  const s = CTX.presupuesto.serie;
  mk("chPresMini", {
    type: "line",
    data: { labels: s.map(x => x.anio), datasets: [{ data: s.map(x => x.pia), borderColor: css("--accent"), backgroundColor: "rgba(226,55,68,.15)", fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: css("--accent") }] },
    options: opts({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` PIA: S/ ${fmt(c.parsed.y)} M` } } }, scales: scales() }),
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
  const prop = foldTop(DATA.por_proponente, 4);
  const propTotal = prop.values.reduce((a, b) => a + b, 0);
  mk("chProp", {
    type: "doughnut",
    data: { labels: prop.labels, datasets: [{ data: prop.values, backgroundColor: palette(prop.labels.length), borderWidth: 2, borderColor: css("--panel") }] },
    options: opts({
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: textC(), boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => ` ${fmt(c.parsed)} proyectos (${(c.parsed / propTotal * 100).toFixed(1)}%)` } },
      },
    }),
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
  // Un solo eje (S/ M): PIA vs Devengado; PIM y avance van en el tooltip.
  // El avance % tiene su propio gráfico (chAvance) — nunca doble eje.
  mk("chPres", {
    type: "bar",
    data: {
      labels: s.map(x => x.anio),
      datasets: [
        { label: "PIA", data: s.map(x => x.pia), backgroundColor: css("--accent"), borderRadius: 4, maxBarThickness: 42 },
        { label: "Devengado (ejecutado)", data: s.map(x => x.devengado), backgroundColor: css("--accent-2"), borderRadius: 4, maxBarThickness: 42 },
      ],
    },
    options: opts({
      plugins: {
        legend: { labels: { color: textC() } },
        tooltip: { callbacks: {
          label: c => ` ${c.dataset.label}: S/ ${fmt(c.parsed.y)} M`,
          afterBody: items => { const r = s[items[0].dataIndex]; return [`PIM: S/ ${fmt(r.pim)} M`, `Avance: ${r.avance}%${r.anio === s.at(-1).anio && r.avance < 70 ? " (año en curso)" : ""}`]; },
        } },
      },
      scales: scales(),
    }),
  });
  const ultimo = s.at(-1);
  mk("chAvance", {
    type: "line",
    data: {
      labels: s.map(x => x.anio),
      datasets: [{
        label: "Avance de ejecución",
        data: s.map(x => x.avance),
        borderColor: css("--amber"), backgroundColor: css("--amber"),
        tension: .3, pointRadius: s.map(x => x.anio === ultimo.anio ? 6 : 4),
        pointStyle: s.map(x => x.anio === ultimo.anio ? "rectRot" : "circle"),
      }],
    },
    options: opts({
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.parsed.y}% del PIM ejecutado${s[c.dataIndex].anio === ultimo.anio ? " · año en curso (parcial)" : ""}` } },
      },
      scales: Object.assign(scales(), { y: { min: 0, max: 100, grid: { color: gridC() }, ticks: { color: textC(), callback: v => v + "%", font: { family: "Inter", size: 11 } }, border: { display: false } } }),
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
    data: { labels: reg.map(r => r.regimen), datasets: [{ data: reg.map(r => r.n), backgroundColor: css("--accent-2"), borderRadius: 4 }] },
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
  const mats = DATA.materias || [];
  const decl = mats.find(m => /Declarativa/.test(m.tema));

  const nota = document.getElementById("periodo-nota");
  if (nota) nota.innerHTML =
    "Se analiza el periodo parlamentario <b>2021–2026</b> (14,864 proyectos). El nuevo Congreso <b>2026–2031</b> se instaló el 27-jul-2026; aún no registra proyectos de ley en la API oficial — se sumará en cuanto empiece a producir.";

  document.getElementById("kpis-analisis").innerHTML =
    kpiCard("Autores principales", fmt(c.autores_principales || 0), "congresistas que lideran proyectos", "var(--accent)") +
    kpiCard("Declarativas", decl ? `${decl.pct}%` : "—", decl ? `${fmt(decl.proyectos)} proyectos simbólicos` : "", "var(--amber)") +
    kpiCard("Top 10 concentra", `${c.top10_pct || 0}%`, "de la producción total", "var(--accent-2)") +
    kpiCard("Líder", prod[0]?.nombre.split(",")[0] || "—", `${fmt(prod[0]?.proyectos || 0)} proyectos`, "var(--purple)");

  // Materias: barras horizontales por # de proyectos
  mk("chMaterias", {
    type: "bar",
    data: {
      labels: mats.map(m => m.tema),
      datasets: [{ data: mats.map(m => m.proyectos), backgroundColor: mats.map(m => /Declarativa/.test(m.tema) ? css("--amber") : css("--accent-2")), borderRadius: 6 }],
    },
    options: opts({
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c2 => ` ${fmt(c2.parsed.x)} proyectos (${mats[c2.dataIndex].pct}%) · ${fmt(mats[c2.dataIndex].leyes)} llegaron a ley` } },
      },
      scales: scales(true),
    }),
  });
  document.getElementById("mat-note").innerHTML = decl
    ? `La materia se infiere por palabras clave del título. El hallazgo más fuerte: <b>${decl.pct}% de los proyectos son declarativos o simbólicos</b> (declara de interés/necesidad pública, días conmemorativos, homenajes) — ${fmt(decl.proyectos)} proyectos, de los cuales ${fmt(decl.leyes)} se volvieron ley. Las materias con más impacto real (salud, seguridad, economía) pesan mucho menos.`
    : "La materia se infiere por palabras clave del título de cada proyecto.";

  const top = prod.slice(0, 15);
  mk("chProd", {
    type: "bar",
    data: { labels: top.map(x => x.nombre), datasets: [{ data: top.map(x => x.proyectos), backgroundColor: css("--accent"), borderRadius: 6 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  });
  document.getElementById("prod-note").innerHTML =
    `Se cuenta como <b>autor principal</b> al primer firmante de cada proyecto. ${fmt(c.autores_principales || 0)} congresistas lideraron al menos un proyecto; los 10 más activos concentran el <b>${c.top10_pct || 0}%</b> de toda la producción legislativa del periodo.`;
}

const MESES_ABBR = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago",
  "set", "oct", "nov", "dic"];

// Días transcurridos desde YYYY-MM-DD hasta hoy (usa la fecha del navegador).
function diasDesde(fechaISO) {
  if (!fechaISO) return null;
  const d = new Date(fechaISO + "T00:00:00");
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function estadoCard(titulo, fecha, sub, fuente, dias) {
  let sem = "var(--green)", txt = "al día";
  if (dias == null) { sem = "var(--muted)"; txt = "—"; }
  else if (dias <= 7) { sem = "var(--green)"; txt = `hace ${dias} día${dias === 1 ? "" : "s"}`; }
  else if (dias <= 45) { sem = "var(--amber)"; txt = `hace ${dias} días`; }
  else { sem = "var(--accent)"; txt = `hace ${dias} días`; }
  return `<div class="card">
    <div class="panel-head"><h3>${titulo}</h3><span class="tag" style="color:${sem};border-color:${sem}">${txt}</span></div>
    <div style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:2px 0 4px">${fecha}</div>
    <div style="color:var(--muted);font-size:13px;margin-bottom:8px">${sub}</div>
    <div class="note" style="margin:0">Fuente: ${fuente}</div>
  </div>`;
}

function renderEstado() {
  const el = document.getElementById("estado-cards");
  if (!el) return;
  const cards = [];

  // Legislativo (data.json)
  const g = DATA.meta?.generado;
  cards.push(estadoCard("Legislativo", g || "—",
    `${fmt(DATA.totales?.proyectos || 0)} proyectos · ${fmt(DATA.totales?.leyes_aprobadas || 0)} leyes · periodo 2021–2026`,
    "API oficial del Congreso (SPLEY)", diasDesde(g)));

  // Personal (personal.json)
  if (PERSONAL) {
    const pg = PERSONAL.meta?.generado, pm = PERSONAL.meta;
    cards.push(estadoCard("Personal (PTE)", pg || "—",
      `Planilla de ${MESES_ABBR[pm.mes]}-${pm.anio} · ${fmt(PERSONAL.totales?.planilla_activa || 0)} activos`,
      "Portal de Transparencia (id_entidad=16)", diasDesde(pg)));
  } else {
    cards.push(estadoCard("Personal (PTE)", "—", "snapshot no disponible", "Portal de Transparencia", null));
  }

  // Presupuesto (context.json)
  const pr = CTX.presupuesto || {};
  const ultAnio = (pr.serie && pr.serie.length) ? pr.serie[pr.serie.length - 1].anio : "—";
  cards.push(estadoCard("Presupuesto (MEF)", String(ultAnio),
    `Serie ${pr.serie?.[0]?.anio || ""}–${ultAnio} · PIA/PIM/devengado`,
    "MEF – Consulta Amigable (SIAF)", null));

  el.innerHTML = cards.join("");
}

// ---- Informe de corte: resumen ejecutivo que cruza los tres datasets ----
function diaDelAnio(fechaISO) {
  const d = new Date(fechaISO + "T00:00:00");
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}
function fechaLarga(fechaISO) {
  return new Date(fechaISO + "T00:00:00").toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" });
}

function renderInforme() {
  const corte = DATA.meta.generado;
  const t = DATA.totales;
  const s = CTX.presupuesto.serie;
  const y = s.at(-1);                       // año en curso (2026)
  const doy = diaDelAnio(corte);
  const gastoDia = y.devengado / doy;       // S/ M por día
  const proyLineal = Math.round(gastoDia * 365);
  const cerrados = s.filter(x => x.anio < y.anio).slice(-3);
  const avHist = cerrados.reduce((a, x) => a + x.avance, 0) / cerrados.length;
  const proyHist = Math.round(y.pim * avHist / 100);
  const gastoPeriodo = s.filter(x => x.anio >= 2021).reduce((a, x) => a + x.devengado, 0);
  const costoLeyM = gastoPeriodo / t.leyes_aprobadas;
  const tasa = (t.leyes_aprobadas / t.proyectos * 100).toFixed(1);
  const mats = DATA.materias || [];
  const decl = mats.find(m => /Declarativa/.test(m.tema));

  const st = document.getElementById("inf-subtitulo");
  if (st) st.textContent = `Corte al ${fechaLarga(corte)} · día ${doy} del año · los tres datasets cruzados`;

  document.getElementById("kpis-informe").innerHTML =
    kpiCard("Gastado en el año", `S/ ${fmt(y.devengado)} M`, `${y.avance}% del PIM al corte`, "var(--accent)") +
    kpiCard("Ritmo de gasto", `S/ ${gastoDia.toFixed(1)} M`, "por día calendario", "var(--amber)") +
    kpiCard("Costo por ley", `S/ ${costoLeyM.toFixed(2)} M`, `gasto 2021–${y.anio} ÷ ${fmt(t.leyes_aprobadas)} leyes`, "var(--accent-2)") +
    kpiCard("Cierre proyectado", `S/ ${fmt(proyHist)} M`, `si repite el patrón histórico (${avHist.toFixed(1)}%)`, "var(--purple)");

  // Resumen ejecutivo narrado
  const P = PERSONAL;
  const parrafos = [
    `<b>Producción legislativa.</b> El periodo 2021–2026 cerró con <b>${fmt(t.proyectos)} proyectos de ley</b> presentados y <b>${fmt(t.leyes_aprobadas)} leyes publicadas</b> (tasa de aprobación de ${tasa}%). ${decl ? `El <b>${decl.pct}% de los proyectos son declarativos o simbólicos</b> (${fmt(decl.proyectos)}), y ${fmt(decl.leyes)} de ellos llegaron a ser ley: <b>1 de cada ${Math.round(t.leyes_aprobadas / decl.leyes)} leyes publicadas es simbólica</b>.` : ""} El nuevo Congreso bicameral 2026–2031 se instaló el 27-jul-2026 y aún no registra proyectos en la API oficial.`,
    `<b>Costo.</b> En ${y.anio} el Congreso tiene un presupuesto modificado (PIM) de <b>S/ ${fmt(y.pim)} M</b> — el más alto de su historia — y al corte lleva ejecutados <b>S/ ${fmt(y.devengado)} M</b> (${y.avance}%), unos <b>S/ ${gastoDia.toFixed(1)} M por día</b>. Dividiendo todo el gasto del periodo (S/ ${fmt(Math.round(gastoPeriodo))} M devengados 2021–${y.anio}) entre las ${fmt(t.leyes_aprobadas)} leyes publicadas, <b>cada ley le costó al país S/ ${costoLeyM.toFixed(2)} M en promedio</b>.`,
    P ? `<b>Personal.</b> La planilla activa suma <b>${fmt(P.totales.planilla_activa)} personas</b> con una masa salarial de <b>${solesM(P.totales.masa_mensual_activa)} al mes</b> (≈ ${solesM(P.totales.masa_anual_activa_est)} al año, el ${(P.totales.masa_anual_activa_est / (y.pim * 1e6) * 100).toFixed(0)}% del PIM). A eso se suman <b>${fmt(P.totales.pensionistas)} pensionistas</b> por ${solesM(P.totales.masa_mensual_pensiones)}/mes. El sueldo más alto es <b>${soles(P.top_sueldos[0].total)}</b> (${P.top_sueldos[0].cargo.toLowerCase()}) y la mediana <b>${soles(P.sueldos.mediana)}</b>. Los <b>${fmt(P.totales.registros)} nombres</b> están en el <a href="#personal" onclick="activar('personal')">buscador de personal</a>.` : "",
    `<b>Proyección.</b> Al ritmo actual, el ${y.anio} cerraría en <b>S/ ${fmt(proyLineal)} M</b> (proyección lineal). Si en cambio repite el patrón de ejecución de los últimos tres años cerrados (avance promedio ${avHist.toFixed(1)}%), terminaría en <b>S/ ${fmt(proyHist)} M</b>. En ambos escenarios sería el año más caro de la historia del Congreso.`,
  ].filter(Boolean);
  document.getElementById("inf-resumen").innerHTML = parrafos.map(p => `<p>${p}</p>`).join("");

  // Proyección de cierre 2026 — una sola medida (S/ M); estimados en tinte claro, techo en gris.
  const azul = css("--accent-2");
  mk("chProyeccion", {
    type: "bar",
    data: {
      labels: [`Ejecutado al corte`, "Proyección lineal", `Patrón histórico (${avHist.toFixed(0)}%)`, "PIM (techo autorizado)"],
      datasets: [{
        data: [y.devengado, proyLineal, proyHist, y.pim],
        backgroundColor: [azul, azul + "88", azul + "88", css("--border")],
        borderColor: [azul, azul, azul, textC()],
        borderWidth: [0, 1, 1, 1],
        borderRadius: 4,
      }],
    },
    options: opts({
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` S/ ${fmt(c.parsed.x)} M (${(c.parsed.x / y.pim * 100).toFixed(1)}% del PIM)` } },
      },
      scales: scales(true),
    }),
  });

  // Impacto por materia: qué % de los proyectos de cada materia llegó a ser ley.
  const conv = mats.filter(m => m.proyectos >= 100)
    .map(m => ({ ...m, tasa: m.leyes / m.proyectos * 100 }))
    .sort((a, b) => b.tasa - a.tasa);
  mk("chImpacto", {
    type: "bar",
    data: {
      labels: conv.map(m => m.tema),
      datasets: [{
        data: conv.map(m => +m.tasa.toFixed(1)),
        backgroundColor: conv.map(m => /Declarativa/.test(m.tema) ? css("--amber") : css("--accent-2")),
        borderRadius: 4,
      }],
    },
    options: opts({
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c2 => { const m = conv[c2.dataIndex]; return ` ${c2.parsed.x}% → ley (${fmt(m.leyes)} de ${fmt(m.proyectos)} proyectos)`; } } },
      },
      scales: scales(true),
    }),
  });
  const notaImp = document.getElementById("inf-impacto-nota");
  if (notaImp && decl) notaImp.innerHTML =
    `Las <b>declarativas/simbólicas</b> (en ámbar) se convierten en ley al <b>${(decl.leyes / decl.proyectos * 100).toFixed(1)}%</b> — igual o mejor que el promedio (${tasa}%): homenajes y días conmemorativos avanzan tan rápido como las leyes con impacto real. Solo materias con ≥100 proyectos.`;

  // Quién trabaja ahí — top sueldos con nombre y apellido
  if (P) {
    document.querySelector("#tInfTop tbody").innerHTML = P.top_sueldos.slice(0, 10).map((r, i) =>
      `<tr><td>${i + 1}</td><td>${r.nombre}</td><td>${r.cargo}</td><td>${r.dependencia || "—"}</td><td style="text-align:right;white-space:nowrap"><b>${soles(r.total)}</b></td></tr>`).join("");
  }

  const nota = document.getElementById("inf-nota");
  if (nota) nota.innerHTML =
    `Metodología: gasto = devengado MEF (Consulta Amigable, pliego 028); el costo por ley divide el gasto total del periodo entre las leyes publicadas (el gasto de 2021 incluye el primer semestre del Congreso anterior). La proyección lineal extrapola el ritmo diario al corte; el patrón histórico aplica el avance promedio de los últimos 3 años cerrados sobre el PIM. La materia se infiere por palabras clave del título. Personal: planilla nominal del PTE, último mes publicado.`;
}

function renderAll() {
  if (!DATA || !CTX) return;
  renderResumen(); renderProyectos(); renderPresupuesto(); renderIncremento();
  renderComisiones(); renderAnalisis(); renderPersonal(); renderEstado(); renderInforme();
}

// Revalidar con el servidor (ETag) para no servir datos viejos de caché:
// el dashboard se regenera a diario y debe reflejar el snapshot más reciente.
const nocache = { cache: "no-cache" };
Promise.all([
  fetch("data.json", nocache).then(r => r.json()),
  fetch("context.json", nocache).then(r => r.json()),
  fetch("personal.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
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
