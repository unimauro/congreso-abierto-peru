/* Congreso Abierto Perú — dashboard multi-sección sobre data.json + context.json. */

const fmt = (n) => new Intl.NumberFormat("es-PE").format(n);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let CHARTS = {};
let DATA = null, CTX = null, PERSONAL = null, BIC = null, PLENOS = null, MOV = null, CON = null, INT = null, VIS = null, PERF = null, ASE = null;
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
  // Desde 2026 el Congreso es bicameral: 130 diputados + 60 senadores (190); antes, 130 congresistas.
  const bic = last.anio >= 2026;
  const nD = BIC ? BIC.congresistas.filter(m => m.camara === "D").length : 130;
  const nS = BIC ? BIC.congresistas.filter(m => m.camara === "S").length : 60;
  const nCong = bic ? nD + nS : 130;
  const nTxt = bic ? ` (${nD} diputados + ${nS} senadores, Congreso bicameral)` : "";
  document.getElementById("pres-unidad").textContent = p.unidad + " · PIA vs Devengado";
  document.getElementById("kpis-pres").innerHTML =
    kpiCard(`PIA ${last.anio}`, `S/ ${fmt(last.pia)} M`, "presupuesto de apertura", "var(--accent)") +
    kpiCard(`Devengado ${last.anio}`, `S/ ${fmt(last.devengado)} M`, `${last.avance}% de avance`, "var(--green)") +
    kpiCard(`Crecimiento ${first.anio}–${last.anio}`, `+${crec}%`, "PIA en el periodo", "var(--amber)") +
    kpiCard("Por congresista", `S/ ${(last.pia / nCong).toFixed(1)} M`, `PIA ÷ ${nCong} congresistas${nTxt}`, "var(--purple)");
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
    t.pensionistas
      ? `Aparte, <b>${fmt(t.pensionistas)} pensionistas</b> (cesantes, viudez y ex-presidentes) cuestan <b>${soles(t.masa_mensual_pensiones)}</b> al mes.`
      : `La planilla de <b>pensionistas</b> de ${MESES[m.mes]} aún no está publicada en el PTE (el último mes con pensiones registró ~530 personas).`,
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
    `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${depHtml(r[3])}</td><td>${r[2]}</td><td>${soles(r[4])}</td></tr>`
  ).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">Sin resultados para “${perState.q}”.</td></tr>`;

  document.getElementById("per-pag").textContent = `Página ${perState.pag + 1} de ${fmt(paginas)}`;
  document.getElementById("per-prev").disabled = perState.pag === 0;
  document.getElementById("per-next").disabled = perState.pag >= paginas - 1;
}

// Si la dependencia es el despacho de un congresista, enlaza a su fila en Bicameral.
function depHtml(dep) {
  if (!dep) return "—";
  const m = congDeDependencia(dep);
  return m ? `<a href="#bicameral?${new URLSearchParams({ cam: m.camara, c: slugify(m.nombre) })}" title="Despacho de ${esc(m.nombre)} (${CAM_NOMBRE[m.camara]})">${esc(dep)}</a>` : esc(dep);
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
  q.addEventListener("input", () => { perState.q = q.value; perState.pag = 0; renderBuscadorPersonal(); syncHash(); });
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

// Gasto del pliego Congreso durante el periodo 2021–2026 (ago-2021 a jul-2026) ÷ leyes.
// 2021 y 2026 se prorratean por meses: 5/12 del devengado 2021 y 7/12 del PIM 2026.
// Una sola fuente para Análisis e Informe: costoPorLeyCalc() da los números, costoPorLey() la tarjeta.
function costoPorLeyCalc() {
  const serie = CTX?.presupuesto?.serie || [], leyes = DATA.totales?.leyes_aprobadas;
  const y = (a) => serie.find(x => x.anio === a);
  if (!leyes || !y(2021) || !y(2026)) return null;
  const millones = y(2021).devengado * 5 / 12 + [2022, 2023, 2024, 2025].reduce((t, a) => t + (y(a)?.devengado || 0), 0) + y(2026).pim * 7 / 12;
  return { millones, leyes, porLey: millones / leyes };
}
function costoPorLey() {
  const c = costoPorLeyCalc();
  if (!c) return "";
  return kpiCard("Costo por ley", `S/ ${c.porLey.toFixed(2)} M`, `≈ S/ ${fmt(Math.round(c.millones))} M gastados ÷ ${fmt(c.leyes)} leyes 2021–26`, "var(--amber)");
}
// Misma frase en Análisis e Informe.
function costoPorLeyTxt() {
  const c = costoPorLeyCalc();
  if (!c) return "";
  return `Dividiendo el gasto del periodo 2021–2026 (≈ S/ ${fmt(Math.round(c.millones))} M de ago-2021 a jul-2026) entre las ${fmt(c.leyes)} leyes publicadas, <b>cada ley costó en promedio S/ ${c.porLey.toFixed(2)} M</b>. Es una medida de productividad gruesa: el pliego también paga representación, fiscalización y administración.`;
}

const banc21Sort = { k: "proyectos", dir: -1 };
function renderBancadas21() {
  const filas = DATA.bancadas || [];
  const tb = document.querySelector("#tBancadas21 tbody");
  if (!tb) return;
  encabezados("tBancadas21", [
    { k: "bancada", t: "Bancada" }, { k: "proyectos", t: "Proyectos", num: 1 }, { k: "leyes", t: "Leyes", num: 1 },
    { k: "pct_ley", t: "% ley", num: 1 }, { k: "pct_simbolico", t: "% simbólico", num: 1 },
  ], banc21Sort, renderBancadas21);
  tb.innerHTML = filas.length ? filas.slice().sort((x, y) => cmp(x[banc21Sort.k], y[banc21Sort.k], banc21Sort.dir)).map(b =>
    `<tr><td>${esc(b.bancada)}</td><td class="num-r">${fmt(b.proyectos)}</td><td class="num-r">${fmt(b.leyes)}</td>
      <td class="num-r">${pctTxt(b.pct_ley)}</td><td class="num-r">${pctTxt(b.pct_simbolico)}</td></tr>`).join("")
    : `<tr><td class="note">Se cargará en el próximo refresco diario.</td></tr>`;
}

function renderAnalisis() {
  renderBancadas21();
  const prod = DATA.produccion_congresistas || [];
  const c = DATA.concentracion || {};
  const mats = DATA.materias || [];
  const decl = mats.find(m => /Declarativa/.test(m.tema));

  const nota = document.getElementById("periodo-nota");
  if (nota) nota.innerHTML =
    `Se analiza el periodo parlamentario <b>2021–2026</b> (${fmt(DATA.totales.proyectos)} proyectos). El nuevo Congreso bicameral <b>2026–2031</b> ya lleva ${BIC ? `<b>${fmt(BIC.totales.proyectos)}</b> proyectos` : "sus primeros proyectos"}: míralo en la pestaña <a href="#bicameral" onclick="activar('bicameral')">Bicameral 2026–31</a>. <b>Costo por ley.</b> ${costoPorLeyTxt()}`;

  document.getElementById("kpis-analisis").innerHTML =
    kpiCard("Autores principales", fmt(c.autores_principales || 0), "congresistas que lideran proyectos", "var(--accent)") +
    kpiCard("Declarativas", decl ? `${decl.pct}%` : "—", decl ? `${fmt(decl.proyectos)} proyectos simbólicos` : "", "var(--amber)") +
    kpiCard("Top 10 concentra", `${c.top10_pct || 0}%`, "de la producción total", "var(--accent-2)") +
    kpiCard("Líder", prod[0]?.nombre.split(",")[0] || "—", `${fmt(prod[0]?.proyectos || 0)} proyectos`, "var(--purple)") +
    costoPorLey();

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

  if (BIC) {
    const t = BIC.totales;
    cards.push(estadoCard("Bicameral 2026–31", BIC.meta.generado,
      `${fmt(t.proyectos)} proyectos · ${fmt(t.congresistas)} congresistas (Senado + Diputados)`,
      "API oficial (codTipoParl S/D/C) + web de cada cámara", diasDesde(BIC.meta.generado)));
  }
  if (CON) {
    cards.push(estadoCard("Contratos (OCDS/SEACE)", CON.meta.generado,
      `${fmt(CON.totales.procesos)} procesos desde ${CON.meta.desde} · ${fmt(CON.totales.proveedores)} proveedores`,
      "Contrataciones Abiertas OECE · bulk mensual, comprador PE-CONSUCODE-6", diasDesde(CON.meta.generado)));
  }
  if (PLENOS) {
    const pl = Object.values(PLENOS.camaras);
    cards.push(estadoCard("Pleno: asistencia y votos", PLENOS.meta.generado,
      `${fmt(pl.reduce((a, c) => a + c.pases_lista, 0))} pases de lista · ${fmt(pl.reduce((a, c) => a + c.votaciones.length, 0))} votaciones nominales`,
      "PDF oficiales de cada sesión (OCR cuando son escaneos)", diasDesde(PLENOS.meta.generado)));
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
  const tasa = (t.leyes_aprobadas / t.proyectos * 100).toFixed(1);
  const mats = DATA.materias || [];
  const decl = mats.find(m => /Declarativa/.test(m.tema));

  const bicTxt = BIC
    ? `El nuevo Congreso bicameral 2026–2031 se instaló el ${fechaLarga(BIC.meta.instalacion)} y al corte registra <b>${fmt(BIC.totales.proyectos)} proyectos</b> (${fmt(BIC.camaras.D.proyectos)} en Diputados y ${fmt(BIC.camaras.S.proyectos)} en el Senado) y ${fmt(BIC.totales.leyes || 0)} leyes: ver <a href="#bicameral">Bicameral 2026–31</a>.`
    : `El nuevo Congreso bicameral 2026–2031 está en la pestaña <a href="#bicameral">Bicameral 2026–31</a>.`;
  const st = document.getElementById("inf-subtitulo");
  if (st) st.textContent = `Corte al ${fechaLarga(corte)} · día ${doy} del año · los tres datasets cruzados`;

  document.getElementById("kpis-informe").innerHTML =
    kpiCard("Gastado en el año", `S/ ${fmt(y.devengado)} M`, `${y.avance}% del PIM al corte`, "var(--accent)") +
    kpiCard("Ritmo de gasto", `S/ ${gastoDia.toFixed(1)} M`, "por día calendario", "var(--amber)") +
    costoPorLey() +
    kpiCard("Cierre proyectado", `S/ ${fmt(proyHist)} M`, `si repite el patrón histórico (${avHist.toFixed(1)}%)`, "var(--purple)");

  // Resumen ejecutivo narrado
  const P = PERSONAL;
  const parrafos = [
    `<b>Producción legislativa.</b> El periodo 2021–2026 cerró con <b>${fmt(t.proyectos)} proyectos de ley</b> presentados y <b>${fmt(t.leyes_aprobadas)} leyes publicadas</b> (tasa de aprobación de ${tasa}%). ${decl ? `El <b>${decl.pct}% de los proyectos son declarativos o simbólicos</b> (${fmt(decl.proyectos)}), y ${fmt(decl.leyes)} de ellos llegaron a ser ley: <b>1 de cada ${Math.round(t.leyes_aprobadas / decl.leyes)} leyes publicadas es simbólica</b>.` : ""} ${bicTxt}`,
    `<b>Costo.</b> En ${y.anio} el Congreso tiene un presupuesto modificado (PIM) de <b>S/ ${fmt(y.pim)} M</b> — el más alto de su historia — y al corte lleva ejecutados <b>S/ ${fmt(y.devengado)} M</b> (${y.avance}%), unos <b>S/ ${gastoDia.toFixed(1)} M por día</b>. ${costoPorLeyTxt()}`,
    P ? `<b>Personal.</b> La planilla activa suma <b>${fmt(P.totales.planilla_activa)} personas</b> con una masa salarial de <b>${solesM(P.totales.masa_mensual_activa)} al mes</b> (≈ ${solesM(P.totales.masa_anual_activa_est)} al año, el ${(P.totales.masa_anual_activa_est / (y.pim * 1e6) * 100).toFixed(0)}% del PIM). ${P.totales.pensionistas ? `A eso se suman <b>${fmt(P.totales.pensionistas)} pensionistas</b> por ${solesM(P.totales.masa_mensual_pensiones)}/mes. ` : ""}El sueldo más alto es <b>${soles(P.top_sueldos[0].total)}</b> (${P.top_sueldos[0].cargo.toLowerCase()}) y la mediana <b>${soles(P.sueldos.mediana)}</b>. Los <b>${fmt(P.totales.registros)} nombres</b> están en el <a href="#personal" onclick="activar('personal')">buscador de personal</a>.` : "",
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
    `Metodología: gasto = devengado MEF (Consulta Amigable, pliego 028); el costo por ley divide el gasto del periodo 2021–2026 (5/12 del devengado 2021, devengado 2022–2025 y 7/12 del PIM 2026) entre las leyes publicadas, igual que en Análisis. La proyección lineal extrapola el ritmo diario al corte; el patrón histórico aplica el avance promedio de los últimos 3 años cerrados sobre el PIM. La materia se infiere por palabras clave del título. Personal: planilla nominal del PTE, último mes publicado.`;
}

// ---- Congreso bicameral 2026–2031 (Senado + Diputados) ----
const CAM_NOMBRE = { D: "Diputados", S: "Senado", C: "Bicameral" };
let bicCam = "D";
let bicState = { q: "", banc: "", k: "principal", dir: -1, pag: 0, ps: 20, abiertos: new Set(), ultimo: "", foco: "", wired: false };
let bancSort = { k: "proyectos", dir: -1 };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pctTxt = (v) => v == null ? "—" : `${v}%`;
// Igual que slug() de web/build_seo.py: NFKD → ASCII, minúsculas, no alfanumérico → "-".
const slugify = (s) => String(s ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
let bicPorSlug = null;
const congPorSlug = (sl) => {
  if (!BIC) return null;
  if (!bicPorSlug) { bicPorSlug = {}; BIC.congresistas.forEach(m => { bicPorSlug[slugify(m.nombre)] = m; }); }
  return bicPorSlug[sl] || null;
};
// Dependencia del PTE ("APELLIDOS NOMBRES") → congresista, por conjunto de palabras (sin tildes ni mayúsculas).
const tokens = (s) => slugify(s).split("-").filter(Boolean);
let depCache = null;
function congDeDependencia(dep) {
  if (!BIC || !dep) return null;
  if (!depCache) depCache = new Map();
  if (depCache.has(dep)) return depCache.get(dep);
  const td = new Set(tokens(dep));
  let m = null;
  if (td.size >= 3) {
    const igual = BIC.congresistas.filter(c => { const tc = tokens(c.nombre); return tc.length === td.size && tc.every(x => td.has(x)); });
    if (igual.length === 1) m = igual[0];
    else if (!igual.length) {   // p. ej. un segundo apellido o nombre de más/menos
      const sub = BIC.congresistas.filter(c => { const tc = new Set(tokens(c.nombre)); return tc.size >= 3 && ([...tc].every(x => td.has(x)) || [...td].every(x => tc.has(x))); });
      if (sub.length === 1) m = sub[0];
    }
  }
  depCache.set(dep, m);
  return m;
}

// ---- Tablas ordenables: clic en el encabezado (numéricas empiezan de mayor a menor) ----
function encabezados(tableId, cols, st, onChange) {
  const tr = document.querySelector(`#${tableId} thead tr`);
  tr.innerHTML = cols.map(c => c.k
    ? `<th class="sortable${c.num ? " num-r" : ""}${st.k === c.k ? " on" : ""}" data-k="${c.k}">${c.t}${st.k === c.k ? (st.dir > 0 ? " ▲" : " ▼") : ""}</th>`
    : `<th${c.num ? ' class="num-r"' : ""}>${c.t}</th>`).join("");
  tr.querySelectorAll("th.sortable").forEach(th => th.onclick = () => {
    const c = cols.find(x => x.k === th.dataset.k);
    st.dir = st.k === c.k ? -st.dir : (c.num ? -1 : 1);
    st.k = c.k;
    onChange();
  });
}
// Compara dejando los vacíos (sin dato) siempre al final.
function cmp(a, b, dir) {
  if (a == null || a === "") return b == null || b === "" ? 0 : 1;
  if (b == null || b === "") return -1;
  return (typeof a === "string" ? a.localeCompare(b, "es") : a - b) * dir;
}

// Índices de asistencia/votos y de despacho por (cámara|nombre)
function bicIndices() {
  const pl = {}, dp = {};
  (PLENOS?.miembros || []).forEach(m => { pl[m.camara + "|" + m.nombre] = m; });
  (MOV?.despachos || []).forEach(m => { dp[m.camara + "|" + m.nombre] = m; });
  return { pl, dp };
}

function renderBicameral() {
  if (!BIC) return;
  const cams = BIC.camaras, C = cams[bicCam], meta = BIC.meta;
  const { pl, dp } = bicIndices();

  // Banner en Resumen
  const bn = document.getElementById("bic-banner");
  if (bn) {
    bn.style.display = "";
    document.getElementById("bic-banner-txt").innerHTML =
      `Desde el ${fechaLarga(meta.instalacion)}: <b>${fmt(cams.D.proyectos)}</b> proyectos en Diputados y <b>${fmt(cams.S.proyectos)}</b> en el Senado. El resto de este tablero analiza el periodo 2021–2026.`;
  }

  document.getElementById("bic-sub").innerHTML =
    `Periodo ${meta.periodo} · instalado el ${fechaLarga(meta.instalacion)} · corte ${fechaLarga(meta.generado)}. Cada cámara numera sus propios proyectos; los de presupuesto y Cuenta General son bicamerales.`;

  // Selector de cámara
  const box = document.getElementById("bic-cams");
  box.innerHTML = "";
  ["D", "S"].forEach(k => {
    const b = document.createElement("button");
    b.className = "ychip" + (k === bicCam ? " active" : "");
    b.textContent = `${cams[k].nombre} (${fmt(cams[k].proyectos)})`;
    b.onclick = () => { bicCam = k; bicState.banc = ""; bicState.pag = 0; bicProy.com = ""; bicProy.pag = 0; renderBicameral(); syncHash(); };
    box.appendChild(b);
  });

  // Asistencia promedio de la cámara
  const miembrosCam = BIC.congresistas.filter(m => m.camara === bicCam);
  const asis = miembrosCam.map(m => pl[bicCam + "|" + m.nombre]).filter(x => x && x.pases);
  const asisProm = asis.length ? (asis.reduce((a, x) => a + x.presente, 0) / asis.reduce((a, x) => a + x.presente + x.ausente, 0) * 100).toFixed(1) : null;
  const sinProy = miembrosCam.filter(m => !m.principal).length;
  document.getElementById("kpis-bic").innerHTML =
    kpiCard("Proyectos presentados", fmt(C.proyectos), `${fmt(C.actualizaciones || 0)} son re-presentados del periodo anterior`, "var(--accent)") +
    kpiCard("Agenda de desarrollo", `${C.pct_desarrollo}%`, `economía, servicios, seguridad · <b style="color:var(--purple)">${C.pct_simbolico}%</b> simbólicos`, "var(--green)") +
    kpiCard("Asistencia al Pleno", asisProm ? `${asisProm}%` : "—", asis.length ? `${fmt(PLENOS.camaras[bicCam]?.pases_lista || 0)} pases de lista · sin contar licencias` : "actas aún no procesadas", "var(--accent-2)") +
    kpiCard("Sin proyecto propio", fmt(sinProy), `de ${fmt(miembrosCam.length)} ${bicCam === "D" ? "diputados" : "senadores"} (como autor principal)`, "var(--amber)");

  // Agenda de desarrollo
  const ag = Object.entries(C.agenda).sort((a, b) => b[1] - a[1]);
  const colAg = (k) => k.startsWith("Simbólico") ? css("--purple") : k.startsWith("Actualización") || k === "Otros" || k.startsWith("Reforma") ? css("--muted") : css("--green");
  mk("chBicAgenda", {
    type: "bar",
    data: { labels: ag.map(e => e[0]), datasets: [{ data: ag.map(e => e[1]), backgroundColor: ag.map(e => colAg(e[0])), _base: ag.map(e => colAg(e[0])), borderRadius: 4 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.x)} proyectos · clic para filtrar` } } }, scales: scales(true),
      onHover: cursorMano, onClick: (e, els) => { if (els.length) filtroBic("eje", ag[els[0].index][0]); } }),
  });
  document.getElementById("bic-agenda-nota").innerHTML =
    `En verde, los ejes que empujan crecimiento, competitividad o servicios básicos (inspirados en la Política Nacional de Competitividad y Productividad y las políticas de Estado del Acuerdo Nacional). En gris, lo que no se puede atribuir (re-presentaciones del periodo anterior, reforma política, otros); en morado, lo simbólico. <b>${fmt(C.riesgo_fiscal)}</b> proyectos tienen señales de <b>riesgo fiscal</b> (exoneraciones, bonos, nombramientos, pensiones). Clasificación por palabras clave del título: es indicativa, no evalúa la calidad del proyecto.`;

  // Bancadas
  const bc = (C.bancadas || []).filter(b => b.miembros);
  mk("chBicBancada", {
    type: "bar",
    data: { labels: bc.map(b => b.bancada), datasets: [
      { label: "Proyectos", data: bc.map(b => b.proyectos), backgroundColor: css("--accent"), _base: css("--accent"), borderRadius: 4 },
      { label: "Por miembro", data: bc.map(b => b.por_miembro), backgroundColor: css("--accent-2"), _base: css("--accent-2"), borderRadius: 4 },
    ] },
    options: opts({ scales: scales(), onHover: cursorMano,
      onClick: (e, els) => { if (els.length) filtroBic("banc", bc[els[0].index].bancada); } }),
  });
  const asisBanc = {};
  miembrosCam.forEach(m => { const x = pl[bicCam + "|" + m.nombre]; if (x && x.pases) { const a = asisBanc[m.bancada] ||= [0, 0]; a[0] += x.presente; a[1] += x.presente + x.ausente; } });
  const filasBanc = (C.bancadas || []).map(b => {
    const a = asisBanc[b.bancada];
    return { ...b, asistencia: a ? +(a[0] / a[1] * 100).toFixed(1) : null };
  });
  const pintarBanc = () => {
    encabezados("tBicBancada", [
      { k: "bancada", t: "Bancada" }, { k: "miembros", t: "Miembros", num: 1 }, { k: "proyectos", t: "Proyectos", num: 1 },
      { k: "por_miembro", t: "x miembro", num: 1 }, { k: "pct_desarrollo", t: "Desarrollo", num: 1 }, { k: "asistencia", t: "Asistencia", num: 1 },
    ], bancSort, pintarBanc);
    document.querySelector("#tBicBancada tbody").innerHTML = filasBanc.slice()
      .sort((x, y) => cmp(x[bancSort.k], y[bancSort.k], bancSort.dir)).map(b =>
        `<tr><td>${esc(b.bancada)}</td><td class="num-r">${b.miembros || "—"}</td><td class="num-r">${fmt(b.proyectos)}</td><td class="num-r">${b.por_miembro ?? "—"}</td><td class="num-r">${pctTxt(b.pct_desarrollo)}</td><td class="num-r">${pctTxt(b.asistencia)}</td></tr>`).join("");
  };
  pintarBanc();

  // Por mes
  const pm = Object.entries(C.por_mes);
  mk("chBicMes", {
    type: "bar",
    data: { labels: pm.map(e => e[0]), datasets: [{ data: pm.map(e => e[1]), backgroundColor: css("--accent"), borderRadius: 4, maxBarThickness: 60 }] },
    options: opts({ plugins: { legend: { display: false } }, scales: scales() }),
  });
  const tCom = document.querySelector("#tBicCom tbody");
  tCom.innerHTML = (C.comisiones || []).map(c =>
    `<tr data-com="${esc(c.nombre)}" tabindex="0" title="Filtrar proyectos de esta comisión"${c.nombre === bicProy.com ? ' class="on"' : ""}><td>${esc(c.nombre)}</td><td class="num-r"><b>${fmt(c.proyectos)}</b></td></tr>`).join("");
  tCom.onclick = e => { const tr = e.target.closest("tr[data-com]"); if (tr) filtroBic("com", tr.dataset.com); };
  tCom.onkeydown = e => { const tr = e.target.closest("tr[data-com]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); filtroBic("com", tr.dataset.com); } };

  // Filtro de bancadas
  const sel = document.getElementById("bic-banc");
  sel.innerHTML = `<option value="">Todas las bancadas</option>` +
    [...new Set(miembrosCam.map(m => m.bancada))].sort().map(b => `<option${b === bicState.banc ? " selected" : ""}>${esc(b)}</option>`).join("");
  if (!bicState.wired) {
    bicState.wired = true;
    document.getElementById("bic-q").addEventListener("input", e => { bicState.q = e.target.value; bicState.pag = 0; renderBicMiembros(); syncHash(); });
    sel.addEventListener("change", e => { bicState.banc = e.target.value; bicState.pag = 0; refrescarBic(); });
    document.getElementById("bic-ps").addEventListener("change", e => { bicState.ps = +e.target.value; bicState.pag = 0; renderBicMiembros(); });
    document.getElementById("bic-prev").addEventListener("click", () => { bicState.pag--; renderBicMiembros(); });
    document.getElementById("bic-next").addEventListener("click", () => { bicState.pag++; renderBicMiembros(); });
    // Desplegar / plegar el detalle de un congresista (delegado: la tabla se repinta)
    document.querySelector("#tBicMiembros tbody").addEventListener("click", e => {
      const cp = e.target.closest(".copylink");
      if (cp) { copiarEnlace(cp); return; }
      const btn = e.target.closest(".xbtn");
      if (!btn) return;
      const n = btn.dataset.n;
      if (bicState.abiertos.has(n)) {
        bicState.abiertos.delete(n);
        if (bicState.ultimo === n) bicState.ultimo = [...bicState.abiertos].at(-1) || "";
      } else { bicState.abiertos.add(n); bicState.ultimo = n; }
      renderBicMiembros();
      syncHash();
    });
  }
  renderBicMiembros();
  renderBicProyectos();
  pintarChipsBic();
  recolorBic();
  renderComisiones26();

  // Votaciones y agenda del Pleno
  const P = PLENOS?.camaras?.[bicCam];
  const vots = P?.votaciones || [];
  const nDiv = vots.filter(v => new Set(Object.values(v.posicion || {})).size > 1).length;
  document.getElementById("bic-vot-hint").textContent = P ? `${fmt(vots.length)} votaciones nominales validadas · ${fmt(nDiv)} divididas` : "actas aún no procesadas";
  renderAfinidad(vots);
  document.querySelector("#tBicVot tbody").innerHTML = vots.length ? vots.map(v => {
    const res = v.si > (v.no || 0) ? "más SI que NO" : "más NO que SI";  // algunas votaciones exigen mayoría calificada
    const pos = Object.entries(v.posicion || {});
    const dividida = new Set(pos.map(e => e[1])).size > 1;
    const POS = { si: ["SI", "si"], no: ["NO", "no"], abst: ["Abst", "ab"] };
    const bancTxt = pos.length ? `<div class="votos" style="margin-top:4px;font-weight:600">${pos.map(([b, x]) => `<span class="${POS[x][1]}">${esc(b)} ${POS[x][0]}</span>`).join("")}</div>` : "";
    return `<tr><td style="white-space:nowrap">${v.fecha}</td><td>${esc(v.asunto || "(sin asunto)")}${dividida ? ` <span class="tag fis">dividida</span>` : ""}${bancTxt}</td>
      <td class="num-r"><div class="votos" style="justify-content:flex-end"><span class="si">${v.si ?? "—"} SI</span><span class="no">${v.no ?? "—"} NO</span><span class="ab">${v.abst ?? "—"} Abst</span></div><span class="tag">${res}</span></td></tr>`;
  }).join("") : `<tr><td colspan="3" class="note">Sin votaciones procesadas para esta cámara.</td></tr>`;
  decorarVotNominal(vots);

  const DOC = { agenda: "Agenda", asistencia: "Asistencia y votos", temas: "Temas tratados", acta: "Acta" };
  document.querySelector("#tBicSes tbody").innerHTML = (P?.sesiones || []).map(s =>
    `<tr><td style="white-space:nowrap">${s.fecha}</td><td>${Object.entries(s.documentos).map(([k, u]) =>
      `<a class="tag" href="${esc(u)}" target="_blank" rel="noopener">${DOC[k] || k}</a>`).join(" ")}</td></tr>`).join("")
    || `<tr><td colspan="2" class="note">Sin sesiones registradas.</td></tr>`;

  // Recientes
  document.querySelector("#tBicRec tbody").innerHTML = BIC.recientes.map(r => {
    const cls = r.agenda.startsWith("Simbólico") ? "sim" : (r.agenda === "Otros" || r.agenda.startsWith("Actualización") || r.agenda.startsWith("Reforma")) ? "" : "dev";
    return `<tr><td>${codLink(r.codigo)}<div class="note" style="margin:2px 0 0">${CAM_NOMBRE[r.camara] || r.camara}</div></td><td style="white-space:nowrap">${r.fecha}</td>
      <td>${esc(r.titulo)}<div class="note" style="margin:2px 0 0">${esc(r.proponente || "")} · ${esc(r.estado)}</div></td>
      <td><span class="tag ${cls}">${esc(r.agenda)}</span>${r.riesgo_fiscal ? ` <span class="tag fis">riesgo fiscal</span>` : ""}</td></tr>`;
  }).join("");

  const calidad = PLENOS ? Object.entries(PLENOS.calidad).map(([k, q]) =>
    `${CAM_NOMBRE[k]}: ${fmt((q.asistencia_total || 0) - (q.asistencia_descartado || 0))}/${fmt(q.asistencia_total || 0)} pases de lista y ${fmt((q.votacion_total || 0) - (q.votacion_descartado || 0))}/${fmt(q.votacion_total || 0)} votaciones validadas`).join("; ") : "";
  document.getElementById("bic-nota").innerHTML =
    `<b>Proyectos</b>: API oficial del Congreso (<span class="code">spley-portal-service</span>) separando cámaras con <span class="code">codTipoParl</span>; bancadas con el filtro oficial <span class="code">grupoParlamentarioId</span> (no se infieren) y autoría principal con <span class="code">congresistaId + tipoFirmanteId=1</span>. ` +
    `<b>Padrón</b> (bancada, partido, distrito): web oficial de cada cámara. ` +
    `<b>Pleno</b>: reportes PDF de asistencia y votación de cada sesión; los escaneados se leen con OCR y cada bloque solo se usa si coincide con el total oficial impreso al pie${calidad ? ` (${calidad})` : ""}. ` +
    `<b>Despacho</b>: personal cuya dependencia en la planilla del PTE es el nombre del congresista${MOV ? ` (${MESES[+MOV.meta.meses.at(-1).slice(5)]} ${MOV.meta.meses.at(-1).slice(0, 4)})` : ""}. ` +
    `<b>Agenda de desarrollo</b>: clasificación por palabras clave del título, indicativa.`;
}

// Matriz: % de votaciones en que dos bancadas tomaron la misma posición mayoritaria.
function renderAfinidad(vots) {
  const box = document.getElementById("bic-afin");
  if (!box) return;
  const bs = [...new Set(vots.flatMap(v => Object.keys(v.posicion || {})))].sort();
  if (bs.length < 2) { box.innerHTML = `<div class="note">Aún no hay suficientes votaciones procesadas.</div>`; return; }
  const celda = (a, b) => {
    let igual = 0, n = 0;
    vots.forEach(v => { const pa = v.posicion?.[a], pb = v.posicion?.[b]; if (pa && pb) { n++; if (pa === pb) igual++; } });
    return n ? igual / n * 100 : null;
  };
  const cohesion = (b) => {
    let con = 0, tot = 0;
    vots.forEach(v => { const pos = v.posicion?.[b], c = v.por_bancada?.[b]; if (!pos || !c) return;
      const e = (c.si || 0) + (c.no || 0) + (c.abst || 0); tot += e; con += c[pos] || 0; });
    return tot ? con / tot * 100 : null;
  };
  const color = (x) => x == null ? "transparent" : `color-mix(in srgb, var(--green) ${Math.round(Math.max(0, x - 40) / 60 * 70)}%, transparent)`;
  box.innerHTML = `<table class="afin"><thead><tr><th></th>${bs.map(b => `<th class="num-r">${esc(b)}</th>`).join("")}<th class="num-r" title="% de sus miembros que votaron con la posición de la bancada">Cohesión</th></tr></thead><tbody>${
    bs.map(a => `<tr><th>${esc(a)}</th>${bs.map(b => {
      if (a === b) return `<td class="num-r note">—</td>`;
      const x = celda(a, b);
      return `<td class="num-r" style="background:${color(x)}">${x == null ? "—" : Math.round(x) + "%"}</td>`;
    }).join("")}<td class="num-r"><b>${pctTxt(cohesion(a) == null ? null : +cohesion(a).toFixed(1))}</b></td></tr>`).join("")}</tbody></table>`;
}

// ---------------------------------------------------------------- voto nominal
// plenos.json: cada votación trae `id` y `votos` (un carácter por congresista de la
// cámara, en el orden de camaras[cam].nominal_orden). Ver pipeline/scrapers/plenos.py.
const VOTO_COD = {
  S: ["SI", "var(--green)"], N: ["NO", "var(--accent)"], A: ["Abst", "var(--amber)"], X: ["Ausente", "var(--muted)"],
  L: ["Licencia", "var(--muted)"], R: ["Sin responder", "var(--muted)"], P: ["Presente", "var(--muted)"], "-": ["Sin dato", "var(--muted)"],
};
const POS_COD = { si: "S", no: "N", abst: "A" };
const nomIdx = {};
const nominalIdx = (cam) => {
  if (!nomIdx[cam]) { nomIdx[cam] = {}; (PLENOS?.camaras?.[cam]?.nominal_orden || []).forEach((n, i) => { nomIdx[cam][n] = i; }); }
  return nomIdx[cam];
};
const ordenVot = (vs) => [...vs].sort((a, b) => (b.id || "").localeCompare(a.id || ""));
const votoTxt = (c) => `<b style="color:${(VOTO_COD[c] || VOTO_COD["-"])[1]}">${(VOTO_COD[c] || VOTO_COD["-"])[0]}</b>`;

// "Cómo votó": voto del congresista en cada votación validada, con la línea de su bancada.
function bloqueComoVoto(m) {
  const P = PLENOS?.camaras?.[m.camara];
  const i = nominalIdx(m.camara)[m.nombre];
  if (!P || i == null) return "";
  const vs = ordenVot(P.votaciones.filter(v => v.votos));
  if (!vs.length) return "";
  let nContra = 0, nAus = 0;
  const filas = vs.map(v => {
    const c = v.votos[i] || "-";
    const pos = v.posicion?.[m.sigla];
    const contra = pos && "SNA".includes(c) && POS_COD[pos] !== c;
    const aus = c === "X";
    nContra += contra; nAus += aus;
    const asu = v.asunto || "(sin asunto)";
    return `<li data-f="${contra ? "contra" : aus ? "aus" : ""}" style="margin:0 0 6px">
      <span class="note" style="white-space:nowrap">${esc(v.fecha)}</span> — <span title="${esc(asu)}">${esc(asu.length > 110 ? asu.slice(0, 110) + "…" : asu)}</span><br>
      ${votoTxt(c)}${pos ? ` <span class="note">· ${esc(m.sigla)}: ${votoTxt(POS_COD[pos])}</span>` : ""}${contra ? ` <span class="tag fis" title="Votó distinto que la mayoría de su bancada">⚠ en contra de su bancada</span>` : ""}</li>`;
  }).join("");
  const chip = (f, t, on) => `<button type="button" class="ychip${on ? " active" : ""}" data-cvf="${f}" style="font-size:12px;padding:4px 10px">${t}</button>`;
  return `<div class="comovoto" style="grid-column:1/-1;max-width:calc(100vw - 72px)"><h4>🗳️ Cómo votó (${vs.length} votaciones)</h4>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${chip("", "Todas", 1)}${chip("contra", `En contra de su bancada (${nContra})`)}${chip("aus", `Ausente (${nAus})`)}</div>
    <ul style="max-height:300px;overflow:auto">${filas}</ul>
    <div class="note">Votaciones nominales del Pleno validadas contra el total oficial (más recientes primero). "Bancada" = voto mayoritario de su grupo. Lectura por OCR: verifica en el acta oficial.</div></div>`;
}

// Filas desplegables en "Votaciones del Pleno": lista nominal agrupada por voto.
const nomAbiertos = new Set();
let nomWired = false;
function decorarVotNominal(vots) {
  const tb = document.querySelector("#tBicVot tbody");
  if (!tb) return;
  [...tb.querySelectorAll(":scope > tr")].forEach((tr, k) => {
    const v = vots[k];
    if (!v?.votos || !tr.cells[1]) return;
    tr.dataset.vid = v.id;
    tr.cells[1].insertAdjacentHTML("afterbegin", `<button type="button" class="xbtn nomx" aria-expanded="false" title="Ver cómo votó cada congresista">▸</button>`);
    if (nomAbiertos.has(v.id)) abrirNominal(tr, v);
  });
  if (!nomWired) {
    nomWired = true;
    tb.addEventListener("click", e => {
      const b = e.target.closest(".nomx");
      if (!b) return;
      const tr = b.closest("tr"), id = tr.dataset.vid;
      const v = Object.values(PLENOS?.camaras || {}).flatMap(c => c.votaciones).find(x => x.id === id);
      if (!v) return;
      if (nomAbiertos.has(id)) { nomAbiertos.delete(id); tr.nextElementSibling?.classList.contains("nomdet") && tr.nextElementSibling.remove(); b.textContent = "▸"; b.setAttribute("aria-expanded", "false"); }
      else { nomAbiertos.add(id); abrirNominal(tr, v); }
    });
  }
}
function abrirNominal(tr, v) {
  const cam = v.id[0];
  const orden = PLENOS.camaras[cam].nominal_orden;
  const bic = {};
  (BIC?.congresistas || []).forEach(m => { if (m.camara === cam) bic[m.nombre] = m; });
  const grupos = {};
  orden.forEach((n, i) => { const c = v.votos[i] || "-"; (grupos[c] = grupos[c] || []).push(n); });
  const G = [["S", "SI"], ["N", "NO"], ["A", "Abstención"], ["X", "Ausentes"], ["L", "Con licencia"], ["R", "Sin responder"], ["P", "Presentes sin voto"], ["-", "Sin dato (no figura o no se pudo leer)"]];
  const html = G.filter(([c]) => grupos[c]?.length).map(([c, t]) =>
    `<div style="margin:0 0 10px"><b style="color:${VOTO_COD[c][1]}">${t} (${grupos[c].length})</b><div style="font-size:12.5px;line-height:1.6">${grupos[c].map(n =>
      `<a href="congresistas/${slugify(n)}.html">${esc(n)}</a>${bic[n]?.sigla ? ` <span class="note">${esc(bic[n].sigla)}</span>` : ""}`).join(" · ")}</div></div>`).join("");
  const b = tr.querySelector(".nomx");
  if (b) { b.textContent = "▾"; b.setAttribute("aria-expanded", "true"); }
  if (tr.nextElementSibling?.classList.contains("nomdet")) tr.nextElementSibling.remove();
  tr.insertAdjacentHTML("afterend", `<tr class="det nomdet"><td colspan="${tr.cells.length}">${html}<div class="note">Lectura del acta oficial (OCR). Totales oficiales: ${v.si ?? "—"} SI, ${v.no ?? "—"} NO, ${v.abst ?? "—"} Abst.</div></td></tr>`);
}

// Chips de filtro del bloque "Cómo votó" (delegado: el detalle se repinta).
document.addEventListener("click", e => {
  const ch = e.target.closest(".comovoto [data-cvf]");
  if (!ch) return;
  const box = ch.closest(".comovoto"), f = ch.dataset.cvf;
  box.querySelectorAll("[data-cvf]").forEach(x => x.classList.toggle("active", x === ch));
  box.querySelectorAll("li[data-f]").forEach(li => { li.style.display = !f || li.dataset.f === f ? "" : "none"; });
});

const mesTxtCorto = (ym) => `${MESES_ABBR[+ym.slice(5)]}-${ym.slice(2, 4)}`;

// Detalle desplegable: gasto mensual del despacho, equipo, proyectos y Pleno.
function detalleCongresista(m, p, d) {
  const bloques = [];
  const bp = bloquePerfil(m);
  if (bp) bloques.push(bp);
  if (d) {
    const max = Math.max(...d.serie.map(x => x.masa));
    const ult = d.serie.at(-1);
    bloques.push(`<div><h4>💸 Gasto mensual del despacho</h4>
      ${d.serie.map(x => `<div class="mbar"><span>${mesTxtCorto(x.mes)}</span><div class="b" style="width:${(x.masa / max * 100).toFixed(0)}%"></div><b>${soles(x.masa)}</b></div>
        <div class="note" style="margin:-2px 0 4px 72px">${x.personal} personas</div>`).join("")}
      <div class="note">≈ <b>${soles(ult.masa * 14)}</b> al año al ritmo de ${mesTxtCorto(ult.mes)} (14 sueldos con gratificaciones). Solo planilla del equipo: el PTE no publica por congresista su remuneración ni sus gastos operativos.${d.serie.length > 2 ? " Los meses previos a ago-26 corresponden a su despacho en el Congreso anterior." : ""}</div></div>`);
    bloques.push(`<div><h4>👥 Equipo (${d.personal})</h4><ul>${d.equipo.map(e =>
      `<li><b>${esc(e.nombre)}</b> — ${esc(e.cargo)} · ${soles(e.total)}${e.apellido ? ` <span class="tag ${e.apellido.some(x => x.raro) ? "fis" : ""}" title="Comparte apellido con el congresista. No prueba parentesco: la Ley 26771 prohíbe contratar parientes hasta el 4.º grado; verificar con la DJ de intereses.">apellido en común: ${esc(e.apellido.map(x => x.apellido).join(", "))}</span>` : ""}${e.antes ? `<br><span class="note">antes: ${esc(e.antes)}</span>` : ""}${trayectoria(m.nombre, e.nombre)}</li>`).join("")}</ul>
      ${ASE && d.equipo.some(e => trayectoria(m.nombre, e.nombre)) ? `<div class="note">🧾 "Antes en el Estado": planillas del PTE, declaraciones juradas, El Peruano y contratos (OCDS), cruzados por nombre completo. Puede haber homónimos; verifica en la fuente.</div>` : ""}
      ${d.equipo.some(e => e.apellido) ? `<div class="note">"Apellido en común" es solo una coincidencia de apellidos con el congresista (en ámbar si el apellido es poco frecuente en la planilla). No prueba parentesco; la Ley 26771 prohíbe contratar parientes hasta el 4.º grado de consanguinidad.</div>` : ""}</div>`);
  } else {
    bloques.push(`<div><h4>💸 Gasto del despacho</h4><div class="note">No se identificó su despacho en la planilla del PTE.</div></div>`);
  }
  const pr = m.proyectos || [];
  // Temáticas: ejes de agenda de sus proyectos como autor principal
  const temas = Object.entries(pr.reduce((acc, x) => (acc[x.agenda] = (acc[x.agenda] || 0) + 1, acc), {})).sort((a, b) => b[1] - a[1]);
  if (temas.length) {
    const tmax = temas[0][1];
    bloques.push(`<div><h4>🧭 Temáticas que trabaja</h4>${temas.map(([t, n]) =>
      `<div class="mbar"><span title="${esc(t)}">${esc(t.length > 26 ? t.slice(0, 26) + "…" : t)}</span><div class="b" style="width:${(n / tmax * 100).toFixed(0)}%;background:${t.startsWith("Simbólico") ? "var(--purple)" : t.startsWith("Actualización") || t === "Otros" || t.startsWith("Reforma") ? "var(--muted)" : "var(--green)"}"></div><b>${n}</b></div>`).join("")}
      <div class="note">Eje de cada proyecto según palabras clave del título (indicativo).</div></div>`);
  }
  bloques.push(`<div style="grid-column:1/-1"><h4>📄 Proyectos como autor principal (${pr.length})</h4>${pr.length ? `<ul style="max-height:240px;overflow:auto">${pr.map(x =>
    `<li>${codLink(x.codigo)} ${esc(x.fecha)} — ${esc(x.titulo.length > 140 ? x.titulo.slice(0, 140) + "…" : x.titulo)} <span class="tag">${esc(x.agenda)}</span></li>`).join("")}</ul>` : `<div class="note">Ninguno como autor principal.</div>`}</div>`);
  if (p && p.pases) {
    bloques.push(`<div><h4>🗳️ En el Pleno</h4><ul>
      <li>Pases de lista: <b>${p.presente}</b> presente, <b>${p.ausente}</b> ausente, <b>${p.licencia}</b> con licencia (de ${p.pases})</li>
      <li>Votaciones: <b style="color:var(--green)">${p.si} SI</b>, <b style="color:var(--accent)">${p.no} NO</b>, <b style="color:var(--amber)">${p.abst} Abst</b>, ${p.no_voto} sin votar (de ${p.votaciones})</li>
      ${disciplina(p) != null ? `<li>Votó igual que su bancada en el <b>${pctTxt(disciplina(p))}</b> de los casos (${p.con_bancada} a favor de la línea, <b>${p.contra_bancada}</b> en contra)</li>` : ""}</ul></div>`);
  }
  const cv = bloqueComoVoto(m);
  if (cv) bloques.push(cv);
  const vi = visDe(m);
  if (vi && vi.total) {
    bloques.push(`<div style="grid-column:1/-1"><h4>🚪 Visitas a su despacho (${fmt(vi.total)} desde ${esc(VIS.meta.desde)})</h4>
      <div class="note" style="margin:0 0 6px">${fmt(vi.al_congresista)} lo/la visitaron directamente; el resto, a su equipo. ${vi.top_entidades.length ? `Instituciones que más vienen: ${vi.top_entidades.slice(0, 5).map(([e, n]) => `<b>${esc(e)}</b> (${n})`).join(", ")}.` : ""}</div>
      <div style="max-height:260px;overflow:auto"><table><thead><tr><th>Fecha</th><th>Visitante</th><th>Institución</th><th>Motivo</th><th>Recibió</th></tr></thead><tbody>${vi.ultimas.map(v =>
        `<tr><td style="white-space:nowrap">${esc(v.fecha)} ${esc(v.hora)}</td><td>${esc(v.visitante)}</td><td>${esc(v.entidad || "—")}</td><td>${esc(v.motivo)}<div class="note" style="margin:0">${esc(v.tipo)}</div></td><td class="note">${esc(v.anfitrion)}</td></tr>`).join("")}</tbody></table></div>
      <div class="note">Registro oficial de visitas del Congreso (últimas ${vi.ultimas.length}). No se muestra el DNI de los visitantes.</div></div>`);
  }
  return `<div class="det-grid">${bloques.join("")}</div>`;
}

// % de votos emitidos (SI/NO/Abst) iguales a la posición mayoritaria de su bancada.
const disciplina = (p) => { const n = (p?.con_bancada || 0) + (p?.contra_bancada || 0); return n ? +(p.con_bancada / n * 100).toFixed(1) : null; };
const discTxt = (p) => { const x = disciplina(p); return x == null ? "—" : `${pctTxt(x)}<div class="note" style="margin:0">${p.contra_bancada} en contra</div>`; };

// Trayectoria pública previa de un asesor (planillas PTE, DJ, El Peruano, OCDS) por coincidencia de nombre completo.
let aseIdx = null;
function trayectoria(despacho, nombre) {
  if (!ASE) return "";
  if (!aseIdx) { aseIdx = {}; ASE.asesores.forEach(a => { if (!a.ambiguo) aseIdx[a.despacho + "|" + a.nombre] = a; }); }
  const a = aseIdx[despacho + "|" + nombre];
  if (!a) return "";
  const per = (h) => h.desde ? (h.hasta && h.hasta !== h.desde ? `${h.desde.slice(0, 4)}–${h.hasta.slice(0, 4)}` : h.desde.slice(0, 4)) : (h.anio || "");
  return `<div class="note" style="margin:2px 0 0">🧾 Antes en el Estado: ${a.historial.slice(0, 3).map(h =>
    `${esc(h.cargo ? h.cargo.toLowerCase() : "")} en <b>${esc(h.entidad)}</b> ${esc(per(h))} <span class="tag">${esc(h.fuente)}</span>`).join("; ")}${a.historial.length > 3 ? ` y ${a.historial.length - 3} más` : ""}</div>`;
}

let perfIdx = null;
const perfDe = (m) => {
  if (!PERF) return null;
  if (!perfIdx) { perfIdx = {}; PERF.perfiles.forEach(x => { perfIdx[x.camara + "|" + x.nombre] = x; }); }
  return perfIdx[m.camara + "|" + m.nombre] || null;
};
// Foto, comisiones y agenda de representación (web oficial de cada cámara)
function bloquePerfil(m) {
  const pf = perfDe(m);
  if (!pf) return "";
  const com = pf.comisiones.map(c => `<li><b>${esc(c.organo)}</b> <span class="tag${/Presid|Vicepres|Secret/.test(c.cargo) ? " dev" : ""}">${esc(c.cargo)}</span> <span class="note">${esc(c.tipo)}</span></li>`).join("");
  const rep = pf.representacion.slice(0, 8).map(r => `<li>${esc(r.fecha)} · ${esc(r.lugar || "—")}${r.pdf ? ` · <a href="${esc(r.pdf)}" target="_blank" rel="noopener">informe PDF</a>` : ""}</li>`).join("");
  const via = pf.viajes.map(v => `<li>${esc(v.fecha)} · ${esc(v.detalle)}${v.pdf ? ` · <a href="${esc(v.pdf)}" target="_blank" rel="noopener">PDF</a>` : ""}</li>`).join("");
  return `<div style="grid-column:1/-1;display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
    ${pf.foto ? `<img src="${esc(pf.foto)}" alt="Foto oficial de ${esc(m.nombre)}" loading="lazy" width="96" height="96" style="width:96px;height:96px;object-fit:cover;border-radius:12px;border:1px solid var(--border)">` : ""}
    <div style="flex:1;min-width:240px"><h4>🏛️ Comisiones y cargos (${pf.comisiones.length})</h4><ul>${com || `<li class="note">Sin comisiones activas registradas.</li>`}</ul></div>
    <div style="flex:1;min-width:240px"><h4>📅 Agenda de representación (${pf.representacion.length})</h4><ul>${rep || `<li class="note">Sin informes publicados.</li>`}</ul>
      ${via ? `<h4>✈️ Viajes al exterior</h4><ul>${via}</ul>` : ""}
      <div class="note">Informes que el congresista presenta tras su semana de representación. La cámara no publica agendas diarias.</div></div></div>`;
}

let visIdx = null;
const visDe = (m) => {
  if (!VIS) return null;
  if (!visIdx) { visIdx = {}; VIS.congresistas.forEach(x => { visIdx[x.camara + "|" + x.nombre] = x; }); }
  return visIdx[m.camara + "|" + m.nombre] || null;
};

// Enlace al expediente oficial (portal SPLEY) según el sufijo del código: -CD Diputados, -S Senado, -CR bicameral
function urlExp(codigo) {
  const m = /^0*(\d+)-(\d{4})-\d{4}-(CD|S|CR)$/.exec(codigo || "");
  if (!m) return null;
  return `https://wb2server.congreso.gob.pe/spley-portal/#/${{ CD: "diputados", S: "senado", CR: "congreso" }[m[3]]}/expediente/${m[2]}/${m[1]}`;
}
const codLink = (codigo) => { const u = urlExp(codigo); return u ? `<a class="code" href="${u}" target="_blank" rel="noopener" title="Ver expediente y texto oficial">${esc(codigo)} ↗</a>` : `<span class="code">${esc(codigo)}</span>`; };

function renderBicMiembros() {
  const { pl, dp } = bicIndices();
  const q = bicState.q.trim().toLowerCase();
  const filas = BIC.congresistas.filter(m => m.camara === bicCam &&
    (!bicState.banc || m.bancada === bicState.banc) &&
    (!q || (m.nombre + " " + m.distrito).toLowerCase().includes(q)))
    .map(m => {
      const p = pl[bicCam + "|" + m.nombre], d = dp[bicCam + "|" + m.nombre];
      return { m, p, d, nombre: m.nombre, sigla: m.sigla, distrito: m.distrito, principal: m.principal,
        desarrollo: m.desarrollo, simbolicos: m.simbolicos, asistencia: p?.pct_asistencia ?? null,
        si: p?.votaciones ? p.si : null, masa: d?.masa ?? null, disciplina: disciplina(p), visitas: visDe(m)?.total ?? null };
    });
  encabezados("tBicMiembros", [
    { k: "nombre", t: "Congresista" }, { k: "sigla", t: "Bancada" }, { k: "distrito", t: "Distrito" },
    { k: "principal", t: "Proyectos", num: 1 }, { k: "desarrollo", t: "Desarrollo", num: 1 }, { k: "simbolicos", t: "Simból.", num: 1 },
    { k: "asistencia", t: "Asistencia", num: 1 }, { k: "si", t: "Votos SI/NO/Abst", num: 1 }, { k: "disciplina", t: "Con su bancada", num: 1 }, { k: "visitas", t: "Visitas", num: 1 }, { k: "masa", t: "Despacho S/ mes", num: 1 },
  ], bicState, () => { bicState.pag = 0; renderBicMiembros(); });
  filas.sort((x, y) => cmp(x[bicState.k], y[bicState.k], bicState.dir) || x.nombre.localeCompare(y.nombre, "es"));
  const foco = bicState.foco;   // enlace profundo: ir a la página del congresista
  if (foco) { const i = filas.findIndex(f => f.nombre === foco); if (i >= 0) bicState.pag = Math.floor(i / bicState.ps); }

  const total = filas.length, paginas = Math.max(1, Math.ceil(total / bicState.ps));
  bicState.pag = Math.min(Math.max(0, bicState.pag), paginas - 1);
  const ini = bicState.pag * bicState.ps, pagina = filas.slice(ini, ini + bicState.ps);
  document.getElementById("bic-count").textContent = `${fmt(total)} ${bicCam === "D" ? "diputados" : "senadores"}`;
  document.getElementById("bic-pag").textContent = total ? `${fmt(ini + 1)}–${fmt(ini + pagina.length)} de ${fmt(total)} · página ${bicState.pag + 1} de ${paginas}` : "sin resultados";
  document.getElementById("bic-prev").disabled = bicState.pag === 0;
  document.getElementById("bic-next").disabled = bicState.pag >= paginas - 1;

  document.querySelector("#tBicMiembros tbody").innerHTML = pagina.map(({ m, p, d }) => {
    const abierto = bicState.abiertos.has(m.nombre);
    const a = p && p.pases ? `${pctTxt(p.pct_asistencia)}<div class="note" style="margin:0">${p.presente}/${p.pases}${p.licencia ? ` · ${p.licencia} lic.` : ""}</div>` : "—";
    const v = p && p.votaciones ? `<span style="color:var(--green)">${p.si}</span>/<span style="color:var(--accent)">${p.no}</span>/<span style="color:var(--amber)">${p.abst}</span><div class="note" style="margin:0">${p.no_voto} sin votar</div>` : "—";
    const eq = d ? `<b>${soles(d.masa)}</b><div class="note" style="margin:0">${d.personal} personas</div>` : "—";
    const nom = `<a href="congresistas/${slugify(m.nombre)}.html" title="Ficha de ${esc(m.nombre)}">${esc(m.nombre)}</a>${m.link ? ` <a class="extlink" href="${esc(m.link)}" target="_blank" rel="noopener" title="Perfil oficial en la web del Congreso" aria-label="Perfil oficial">↗</a>` : ""}`;
    return `<tr><td style="white-space:nowrap">${typeof cmpCheck === "function" ? cmpCheck(m) : ""}<button class="xbtn" data-n="${esc(m.nombre)}" aria-expanded="${abierto}" title="Ver detalle">${abierto ? "▾" : "▸"}</button>${nom}</td>
      <td><span class="tag">${esc(m.sigla)}</span></td><td>${esc(m.distrito)}</td>
      <td class="num-r"><b>${fmt(m.principal)}</b><div class="note" style="margin:0">${fmt(m.firmas)} firmas</div></td>
      <td class="num-r">${fmt(m.desarrollo)}</td><td class="num-r">${fmt(m.simbolicos)}</td>
      <td class="num-r">${a}</td><td class="num-r">${v}</td><td class="num-r">${discTxt(p)}</td><td class="num-r">${visDe(m) ? `<b>${fmt(visDe(m).total)}</b><div class="note" style="margin:0">${fmt(visDe(m).al_congresista)} a él/ella</div>` : "—"}</td><td class="num-r">${eq}</td></tr>` +
      (abierto ? `<tr class="det"><td colspan="11">${barraEnlace(m)}${detalleCongresista(m, p, d)}</td></tr>` : "");
  }).join("");
  if (typeof cmpSync === "function") cmpSync();   // modo comparar (web/comparar.js)
  if (foco) {
    bicState.foco = "";
    const b = [...document.querySelectorAll("#tBicMiembros .xbtn")].find(x => x.dataset.n === foco);
    if (b) setTimeout(() => {   // descuenta la cabecera y el menú fijos (más altos en móvil)
      const tope = Math.max(...["header", ".menu"].map(sel => document.querySelector(sel)?.getBoundingClientRect().bottom || 0));
      window.scrollTo({ top: window.scrollY + b.closest("tr").getBoundingClientRect().top - tope - 8, behavior: "smooth" });
    }, 60);
  }
}

// ---- Bicameral: lista completa de proyectos + filtros cruzados (gráficos ↔ tablas) ----
// eje/com/est/rf/q filtran la lista de proyectos; la bancada (bicState.banc) filtra
// a la vez congresistas y proyectos (bancada del autor principal).
let bicProy = { q: "", eje: "", com: "", est: "", rf: "", k: "fecha", dir: -1, pag: 0, ps: 20, wired: false };
const bicProyCache = {};
// Todos los proyectos de la cámara. bicameral.json trae `proyectos` (lista completa);
// si falta (versión anterior), se reconstruye con los de cada autor + los recientes.
function bicProyectos(cam) {
  if (bicProyCache[cam]) return bicProyCache[cam];
  const C = BIC.camaras[cam] || {}, coms = C.comisiones || [];
  const memb = {};
  BIC.congresistas.forEach(m => { memb[m.camara + "|" + m.nombre] = m; });
  let lista;
  if (Array.isArray(BIC.proyectos)) {
    lista = BIC.proyectos.filter(p => p.camara === cam).map(p => ({ ...p, comisiones: (p.com || []).map(i => coms[i]?.nombre).filter(Boolean) }));
  } else {
    const vistos = new Map();
    BIC.congresistas.filter(m => m.camara === cam).forEach(m => (m.proyectos || []).forEach(p => {
      if (!vistos.has(p.codigo)) vistos.set(p.codigo, { ...p, camara: cam, autor: m.nombre, comisiones: [] });
    }));
    (BIC.recientes || []).filter(r => r.camara === cam).forEach(r => {
      const x = vistos.get(r.codigo);
      if (x) x.riesgo_fiscal = r.riesgo_fiscal;
      else vistos.set(r.codigo, { ...r, comisiones: [] });
    });
    lista = [...vistos.values()];
  }
  lista.forEach(p => {
    const m = p.autor ? memb[cam + "|" + p.autor] : null;
    p.m = m; p.bancada = m?.bancada || "";
    p._txt = (p.codigo + " " + p.titulo + " " + (p.autor || p.proponente || "")).toLowerCase();
  });
  return (bicProyCache[cam] = lista);
}
// Color atenuado para las barras no seleccionadas (#rrggbb → #rrggbb40).
function atenuar(c, si) { return si && /^#[0-9a-f]{6}$/i.test(c) ? c + "40" : c; }
function cursorMano(e, els) { if (e.native?.target) e.native.target.style.cursor = els.length ? "pointer" : "default"; }
// Atenúa en los gráficos lo que no está seleccionado (sin recrearlos: el clic
// llega desde el propio gráfico y destruirlo ahí rompe a Chart.js).
function recolorBic() {
  const a = CHARTS.chBicAgenda;
  if (a) { const d = a.data.datasets[0]; d.backgroundColor = d._base.map((c, i) => atenuar(c, bicProy.eje && bicProy.eje !== a.data.labels[i])); a.update("none"); }
  const b = CHARTS.chBicBancada;
  if (b) { b.data.datasets.forEach(d => { d.backgroundColor = b.data.labels.map(l => atenuar(d._base, bicState.banc && bicState.banc !== l)); }); b.update("none"); }
}
// Repinta solo lo que depende de los filtros cruzados.
function refrescarBic() {
  const sel = document.getElementById("bic-banc");
  if (sel) sel.value = bicState.banc;
  document.querySelectorAll("#tBicCom tbody tr[data-com]").forEach(tr => tr.classList.toggle("on", tr.dataset.com === bicProy.com));
  renderBicMiembros();
  renderBicProyectos();
  pintarChipsBic();
  recolorBic();
  syncHash();
}
// Activa (o desactiva si ya estaba) un filtro cruzado.
function filtroBic(tipo, valor) {
  if (tipo === "banc") { bicState.banc = bicState.banc === valor ? "" : valor; bicState.pag = 0; }
  else bicProy[tipo] = bicProy[tipo] === valor ? "" : valor;
  bicProy.pag = 0;
  refrescarBic();
}
const CHIP_TXT = { eje: "Eje", com: "Comisión", banc: "Bancada", est: "Estado", rf: "Riesgo fiscal" };
function pintarChipsBic() {
  const act = [];
  if (bicProy.eje) act.push(["eje", bicProy.eje]);
  if (bicProy.com) act.push(["com", bicProy.com]);
  if (bicState.banc) act.push(["banc", bicState.banc]);
  if (bicProy.est) act.push(["est", bicProy.est]);
  if (bicProy.rf) act.push(["rf", bicProy.rf === "1" ? "con riesgo" : "sin riesgo"]);
  const chips = act.map(([k, v]) => `<button class="fchip" data-k="${k}" title="Quitar filtro"><span>${CHIP_TXT[k]}: ${esc(v)}</span> ✕</button>`).join("");
  const n = document.getElementById("bicp-count")?.dataset.n || "0";
  const top = document.getElementById("bic-chips-top"), pr = document.getElementById("bic-chips-proy");
  const limpiar = act.length > 1 ? `<button class="btn" data-k="*">Quitar todos</button>` : "";
  if (top) top.innerHTML = act.length ? `<span class="note" style="margin:0">Filtro activo:</span>${chips}${limpiar}<a class="note" style="margin:0" href="#bic-proy-card" data-ir="1">ver ${fmt(+n)} proyectos ↓</a>` : "";
  if (pr) pr.innerHTML = act.length ? chips + limpiar : "";
  [top, pr].forEach(box => box && (box.onclick = e => {
    const ir = e.target.closest("[data-ir]");
    if (ir) { e.preventDefault(); document.getElementById("bic-proy-card").scrollIntoView({ behavior: "smooth" }); return; }
    const b = e.target.closest("[data-k]");
    if (!b) return;
    const k = b.dataset.k;
    if (k === "*") { bicProy.eje = bicProy.com = bicProy.est = bicProy.rf = ""; bicState.banc = ""; }
    else if (k === "banc") bicState.banc = "";
    else bicProy[k] = "";
    bicState.pag = 0; bicProy.pag = 0;
    refrescarBic();
  }));
}
function renderBicProyectos() {
  if (!BIC || !document.getElementById("tBicProy")) return;
  const todos = bicProyectos(bicCam);
  const C = BIC.camaras[bicCam] || {};
  const opt = (v, txt, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(txt)}</option>`;
  const ejes = Object.keys(C.agenda || {});
  const estados = [...new Set(todos.map(p => p.estado))].sort((a, b) => a.localeCompare(b, "es"));
  // Valores que ya no existen en esta cámara (p. ej. tras cambiar de cámara) se descartan.
  if (bicProy.eje && !ejes.includes(bicProy.eje)) bicProy.eje = "";
  if (bicProy.est && !estados.includes(bicProy.est)) bicProy.est = "";
  if (bicProy.com && !(C.comisiones || []).some(c => c.nombre === bicProy.com)) bicProy.com = "";
  document.getElementById("bicp-eje").innerHTML = opt("", "Todos los ejes", bicProy.eje) + ejes.map(e => opt(e, e, bicProy.eje)).join("");
  document.getElementById("bicp-est").innerHTML = opt("", "Todos los estados", bicProy.est) + estados.map(e => opt(e, e, bicProy.est)).join("");
  document.getElementById("bicp-banc").innerHTML = opt("", "Bancada del autor: todas", bicState.banc) +
    [...new Set(BIC.congresistas.filter(m => m.camara === bicCam).map(m => m.bancada))].sort().map(b => opt(b, b, bicState.banc)).join("");
  document.getElementById("bicp-rf").value = bicProy.rf;
  const qi = document.getElementById("bicp-q");
  if (qi.value !== bicProy.q) qi.value = bicProy.q;

  if (!bicProy.wired) {
    bicProy.wired = true;
    const set = (k) => (e) => { bicProy[k] = e.target.value; bicProy.pag = 0; renderBicProyectos(); pintarChipsBic(); syncHash(); };
    qi.addEventListener("input", set("q"));
    document.getElementById("bicp-est").addEventListener("change", set("est"));
    document.getElementById("bicp-rf").addEventListener("change", set("rf"));
    // eje y bancada también recolorean los gráficos y la tabla de congresistas
    document.getElementById("bicp-eje").addEventListener("change", e => { bicProy.eje = e.target.value; bicProy.pag = 0; refrescarBic(); });
    document.getElementById("bicp-banc").addEventListener("change", e => { bicState.banc = e.target.value; bicState.pag = 0; bicProy.pag = 0; refrescarBic(); });
    document.getElementById("bicp-prev").addEventListener("click", () => { bicProy.pag--; renderBicProyectos(); });
    document.getElementById("bicp-next").addEventListener("click", () => { bicProy.pag++; renderBicProyectos(); });
  }

  const q = bicProy.q.trim().toLowerCase();
  const filas = todos.filter(p =>
    (!bicProy.eje || p.agenda === bicProy.eje) &&
    (!bicProy.com || p.comisiones.includes(bicProy.com)) &&
    (!bicProy.est || p.estado === bicProy.est) &&
    (!bicState.banc || p.bancada === bicState.banc) &&
    (!bicProy.rf || !!p.riesgo_fiscal === (bicProy.rf === "1")) &&
    (!q || p._txt.includes(q)));
  encabezados("tBicProy", [
    { k: "codigo", t: "Código" }, { k: "fecha", t: "Fecha", num: 1 }, { t: "Título" }, { k: "autor", t: "Autor" }, { k: "estado", t: "Estado" },
  ], bicProy, () => { bicProy.pag = 0; renderBicProyectos(); });
  filas.sort((x, y) => cmp(x[bicProy.k], y[bicProy.k], bicProy.dir) || cmp(x.codigo, y.codigo, -1));
  const total = filas.length, paginas = Math.max(1, Math.ceil(total / bicProy.ps));
  bicProy.pag = Math.min(Math.max(0, bicProy.pag), paginas - 1);
  const ini = bicProy.pag * bicProy.ps, pagina = filas.slice(ini, ini + bicProy.ps);
  const cnt = document.getElementById("bicp-count");
  cnt.dataset.n = total;
  cnt.textContent = total === todos.length ? `${fmt(total)} proyectos` : `${fmt(total)} de ${fmt(todos.length)} proyectos`;
  document.getElementById("bicp-pag").textContent = total ? `${fmt(ini + 1)}–${fmt(ini + pagina.length)} de ${fmt(total)} · página ${bicProy.pag + 1} de ${paginas}` : "sin resultados";
  document.getElementById("bicp-prev").disabled = bicProy.pag === 0;
  document.getElementById("bicp-next").disabled = bicProy.pag >= paginas - 1;
  const clsAg = (a) => a.startsWith("Simbólico") ? "sim" : (a === "Otros" || a.startsWith("Actualización") || a.startsWith("Reforma")) ? "" : "dev";
  document.querySelector("#tBicProy tbody").innerHTML = pagina.map(p => {
    const autor = p.m ? `<a href="congresistas/${slugify(p.m.nombre)}.html" title="Ficha de ${esc(p.m.nombre)}">${esc(p.m.nombre)}</a><div class="note" style="margin:0"><span class="tag">${esc(p.m.sigla)}</span></div>`
      : esc(p.autor || p.proponente || "—");
    const com = p.comisiones.length ? `<div class="note" style="margin:2px 0 0">Comisión: ${p.comisiones.map(esc).join(" · ")}</div>` : "";
    return `<tr><td>${codLink(p.codigo)}</td><td style="white-space:nowrap">${esc(p.fecha)}</td>
      <td class="tit">${esc(p.titulo)}<div style="margin-top:4px"><span class="tag ${clsAg(p.agenda)}">${esc(p.agenda)}</span>${p.riesgo_fiscal ? ` <span class="tag fis">riesgo fiscal</span>` : ""}</div>${com}</td>
      <td>${autor}</td><td><span class="tag">${esc(p.estado)}</span></td></tr>`;
  }).join("") || `<tr><td colspan="5" class="note">Ningún proyecto coincide con los filtros.</td></tr>`;
}

// ---- Comisiones 2026–2031: proyectos derivados (BIC) + mesa directiva y miembros (perfiles) ----
let com26Cam = "D";
const normCom = (s) => tokens(s).filter(t => !["comision", "de", "en", "asuntos", "y", "la", "del", "el", "los", "las"].includes(t));
function renderComisiones26() {
  const tb = document.querySelector("#tCom26 tbody");
  if (!tb || !BIC) return;
  const box = document.getElementById("com26-cams");
  box.innerHTML = "";
  ["D", "S"].forEach(k => {
    const b = document.createElement("button");
    b.className = "ychip" + (k === com26Cam ? " active" : "");
    b.textContent = BIC.camaras[k]?.nombre || CAM_NOMBRE[k];
    b.onclick = () => { com26Cam = k; renderComisiones26(); };
    box.appendChild(b);
  });
  // Órganos de los perfiles (sin bancadas ni órganos directivos)
  const org = new Map();
  (PERF?.perfiles || []).filter(x => x.camara === com26Cam).forEach(x => x.comisiones.forEach(c => {
    if (/Grupo parlamentario|Órgano directivo/i.test(c.tipo)) return;
    const o = org.get(c.organo) || { nombre: c.organo, tipo: c.tipo, pres: [], vice: [], secr: [], tit: 0, sup: 0 };
    const cg = c.cargo || "";
    if (/^Presiden/i.test(cg)) o.pres.push(x);
    else if (/Vicepresiden/i.test(cg)) o.vice.push(x);
    else if (/^Secretari/i.test(cg)) o.secr.push(x);
    if (/Suplente/i.test(cg)) o.sup++; else o.tit++;
    org.set(c.organo, o);
  }));
  // Cruce por palabras con las comisiones de la API (los nombres no son idénticos)
  const api = (BIC.camaras[com26Cam]?.comisiones || []).map(c => ({ ...c, t: new Set(normCom(c.nombre)) }));
  const filas = [...org.values()].map(o => {
    const t = new Set(normCom(o.nombre));
    let mejor = null, js = 0;
    api.forEach(c => { const i = [...t].filter(x => c.t.has(x)).length, j = i / new Set([...t, ...c.t]).size; if (j > js) { js = j; mejor = c; } });
    if (js >= 0.5 && !mejor.usada) mejor.usada = true; else mejor = null;
    return { ...o, api: mejor };
  });
  api.filter(c => !c.usada).forEach(c => filas.push({ nombre: c.nombre, tipo: "", pres: [], vice: [], secr: [], tit: 0, sup: 0, api: c }));
  filas.sort((a, b) => (b.api?.proyectos ?? -1) - (a.api?.proyectos ?? -1) || a.nombre.localeCompare(b.nombre, "es"));
  const gente = (xs) => xs.length ? xs.map(x => `<a href="congresistas/${slugify(x.nombre)}.html">${esc(x.nombre)}</a>`).join("<br>") : "—";
  tb.innerHTML = filas.map(f => {
    const pr = f.api ? `<a href="#bicameral?${new URLSearchParams({ cam: com26Cam, com: f.api.nombre })}" title="Ver los proyectos de esta comisión"><b>${fmt(f.api.proyectos)}</b></a>` : "—";
    const nom = f.nombre.length > 140 ? f.nombre.slice(0, 137) + "…" : f.nombre;
    return `<tr><td>${esc(nom)}${f.tipo ? `<div class="note" style="margin:2px 0 0">${esc(f.tipo)}</div>` : ""}</td><td class="num-r">${pr}</td>
      <td>${gente(f.pres)}</td><td>${gente(f.vice)}</td><td>${gente(f.secr)}</td>
      <td class="num-r">${f.tit + f.sup ? `<b>${fmt(f.tit)}</b><div class="note" style="margin:0">+ ${fmt(f.sup)} supl.</div>` : "—"}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="note">Sin datos de comisiones.</td></tr>`;
  document.getElementById("com26-hint").textContent = `${fmt(filas.length)} órganos${PERF ? "" : " · cargos no disponibles"}`;
}

// Barra sobre el detalle: enlace para compartir y ficha estática.
function barraEnlace(m) {
  const sl = slugify(m.nombre);
  return `<div class="det-bar"><button class="btn copylink" data-c="${esc(m.camara)}" data-s="${sl}">🔗 Copiar enlace</button>
    <a class="btn" href="congresistas/${sl}.html">📄 Ficha</a>${m.link ? `<a class="btn" href="${esc(m.link)}" target="_blank" rel="noopener">Perfil oficial ↗</a>` : ""}</div>`;
}
async function copiarEnlace(btn) {
  const url = `${location.origin}${location.pathname}#bicameral?${new URLSearchParams({ cam: btn.dataset.c, c: btn.dataset.s })}`;
  const txt = btn.textContent;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "✅ Enlace copiado";
  } catch (e) {
    try { window.prompt("Copia este enlace:", url); } catch (_) { /* sin diálogo disponible */ }
    btn.textContent = "Copia el enlace manualmente";
  }
  setTimeout(() => { btn.textContent = txt; }, 2000);
}

// ---- Movimientos de personal (altas/bajas entre meses publicados) ----
function renderMovimientos() {
  const card = document.getElementById("mov-card");
  if (!MOV || !card) return;
  card.style.display = "";
  const mesTxt = (ym) => `${MESES_ABBR[+ym.slice(5)]}-${ym.slice(0, 4)}`;
  const s = MOV.serie;
  mk("chMovSerie", {
    type: "bar",
    data: { labels: s.map(x => mesTxt(x.mes)), datasets: [{ label: "Planilla activa (personas)", data: s.map(x => x.activos), backgroundColor: css("--accent-2"), borderRadius: 4, maxBarThickness: 60 }] },
    options: opts({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y)} personas · ${solesM(s[c.dataIndex].masa)}/mes` } } }, scales: scales() }),
  });
  document.querySelector("#tMov tbody").innerHTML = MOV.comparaciones.map(c =>
    `<tr><td style="white-space:nowrap">${mesTxt(c.desde)} → ${mesTxt(c.hasta)}</td><td class="num-r" style="color:var(--green)"><b>+${fmt(c.altas)}</b></td><td class="num-r" style="color:var(--accent)"><b>−${fmt(c.bajas)}</b></td><td class="num-r">${fmt(c.cambio_dependencia)}</td><td class="num-r">${solesM(c.masa_hasta)}</td></tr>`).join("");

  // El cambio de Congreso (julio → agosto 2026) es el mayor recambio
  const big = MOV.comparaciones.slice().sort((a, b) => (b.altas + b.bajas) - (a.altas + a.bajas))[0];
  const ult = MOV.comparaciones.at(-1);
  const D = MOV.despachos;
  const enDesp = D.reduce((a, x) => a + x.personal, 0), cont = D.reduce((a, x) => a + x.continuan, 0);
  const masaDesp = D.reduce((a, x) => a + x.masa, 0);
  document.getElementById("mov-facts").innerHTML = [
    big ? `El mayor recambio fue <b>${mesTxt(big.desde)} → ${mesTxt(big.hasta)}</b> (instalación del Congreso bicameral): <b>${fmt(big.altas)} altas</b> y <b>${fmt(big.bajas)} bajas</b>; ${fmt(big.cambio_dependencia)} personas se quedaron pero cambiaron de oficina.` : "",
    D.length ? `<b>${fmt(enDesp)} personas</b> trabajan en los despachos de <b>${fmt(D.length)} congresistas</b> (${solesM(masaDesp)}/mes, ~${fmt(Math.round(enDesp / D.length))} por despacho). <b>${fmt(cont)}</b> (${(cont / enDesp * 100).toFixed(0)}%) ya estaban en la planilla en ${mesTxt(MOV.meta.referencia_despachos)}, es decir, vienen del Congreso anterior. Los equipos por congresista están en la vista <a href="#bicameral" onclick="activar('bicameral')">Bicameral</a>.` : "",
    ult ? `Último mes publicado (${mesTxt(ult.hasta)}): <b>+${fmt(ult.altas)}</b> altas y <b>−${fmt(ult.bajas)}</b> bajas frente a ${mesTxt(ult.desde)}.` : "",
  ].filter(Boolean).map(x => `<li>${x}</li>`).join("");
  document.getElementById("mov-altas-hint").textContent = big ? `${mesTxt(big.desde)} → ${mesTxt(big.hasta)}` : "";
  document.querySelector("#tMovAltas tbody").innerHTML = (big?.top_altas || []).map(r =>
    `<tr><td>${esc(r.nombre)}</td><td>${esc(r.cargo)}</td><td>${esc(r.dependencia)}</td><td class="num-r"><b>${soles(r.total)}</b></td></tr>`).join("");
  document.querySelector("#tMovBanc tbody").innerHTML = MOV.bancadas.map(b =>
    `<tr><td>${esc(b.grupo)}</td><td class="num-r">${fmt(b.personal)}</td><td class="num-r">${soles(b.masa)}</td></tr>`).join("");
  document.getElementById("mov-nota").textContent = `${MOV.meta.nota} Meses disponibles: ${MOV.meta.meses.map(mesTxt).join(", ")}.`;
}

// ---- Contratos (OCDS / SEACE) ----
const conState = { q: "", anio: "", unico: false, wired: false };
const provSort = { k: "monto", dir: -1 };
const millon = (x) => `S/ ${(x / 1e6).toLocaleString("es-PE", { maximumFractionDigits: 1 })} M`;
function renderContratos() {
  const sec = document.getElementById("view-contratos");
  if (!sec) return;
  if (!CON) { document.getElementById("kpis-con").innerHTML = `<div class="card note">Los contratos se cargarán en el próximo refresco.</div>`; return; }
  const t = CON.totales, anios = Object.entries(CON.por_anio);
  document.getElementById("con-sub").innerHTML =
    `Procesos registrados en SEACE con el Congreso como comprador, desde ${CON.meta.desde} · corte ${fechaLarga(CON.meta.generado)}. Fuente: Contrataciones Abiertas (OCDS) de la OECE.`;
  const unicoPct = t.adjudicados ? (t.postor_unico / t.adjudicados * 100).toFixed(0) : 0;
  document.getElementById("kpis-con").innerHTML =
    kpiCard("Monto contratado", millon(t.monto), `${fmt(t.adjudicados)} procesos adjudicados de ${fmt(t.procesos)}`, "var(--accent)") +
    kpiCard("Proveedores", fmt(t.proveedores), "empresas o personas distintas", "var(--accent-2)") +
    kpiCard("Top 10 concentra", `${t.top10_pct}%`, "del monto contratado", "var(--purple)") +
    kpiCard("Un solo postor", `${unicoPct}%`, `${fmt(t.postor_unico)} procesos adjudicados sin competencia`, "var(--amber)");

  mk("chConAnio", {
    type: "bar",
    data: { labels: anios.map(e => e[0]), datasets: [{ data: anios.map(e => +(e[1].monto / 1e6).toFixed(1)), backgroundColor: css("--accent"), borderRadius: 4, maxBarThickness: 60 }] },
    options: opts({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` S/ ${c.parsed.y} M · ${fmt(anios[c.dataIndex][1].procesos)} procesos` } } }, scales: scales() }),
  });
  const met = Object.entries(CON.por_metodo).filter(e => e[1] > 0).slice(0, 8);
  mk("chConMetodo", {
    type: "bar",
    data: { labels: met.map(e => e[0]), datasets: [{ data: met.map(e => +(e[1] / 1e6).toFixed(1)), backgroundColor: met.map(e => /Directa/i.test(e[0]) ? css("--amber") : css("--accent-2")), borderRadius: 4 }] },
    options: opts({ indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` S/ ${c.parsed.x} M` } } }, scales: scales(true) }),
  });

  const pintarProv = () => {
    encabezados("tConProv", [
      { k: "nombre", t: "Proveedor" }, { k: "ruc", t: "RUC" }, { k: "procesos", t: "Procesos", num: 1 },
      { k: "monto", t: "Monto", num: 1 }, { k: "pct", t: "% del total", num: 1 },
    ], provSort, pintarProv);
    document.querySelector("#tConProv tbody").innerHTML = CON.proveedores.slice().sort((x, y) => cmp(x[provSort.k], y[provSort.k], provSort.dir)).map(p =>
      `<tr><td>${esc(p.nombre)}${intTag(p.ruc)}</td><td class="code">${esc(p.ruc)}</td><td class="num-r">${fmt(p.procesos)}</td><td class="num-r"><b>${soles(p.monto)}</b></td><td class="num-r">${pctTxt(p.pct)}</td></tr>`).join("");
  };
  pintarProv();
  document.getElementById("con-prov-hint").textContent = `top ${CON.proveedores.length} por monto`;

  const selA = document.getElementById("con-anio");
  selA.innerHTML = `<option value="">Todos los años</option>` + anios.map(e => e[0]).reverse().map(a => `<option${a === conState.anio ? " selected" : ""}>${a}</option>`).join("");
  if (!conState.wired) {
    conState.wired = true;
    document.getElementById("con-q").addEventListener("input", e => { conState.q = e.target.value; pintarProcesos(); syncHash(); });
    selA.addEventListener("change", e => { conState.anio = e.target.value; pintarProcesos(); syncHash(); });
    document.getElementById("con-unico").addEventListener("change", e => { conState.unico = e.target.checked; pintarProcesos(); });
  }
  pintarProcesos();
  document.getElementById("con-nota").innerHTML = `${esc(CON.meta.nota)} Los procesos sin monto aún están en convocatoria, desiertos o sin contrato publicado. <b>Un solo postor</b> no implica irregularidad, pero es la señal clásica de baja competencia.`;
}
const intTag = (ruc) => {
  const x = INT?.proveedores?.find(p => p.ruc === ruc);
  if (!x || !x.sanciones.length) return "";
  return x.vigente ? ` <span class="tag fis" title="Inhabilitación vigente del Tribunal de Contrataciones">inhabilitado hoy</span>` : ` <span class="tag" title="Tuvo sanción del Tribunal de Contrataciones">sanción previa</span>`;
};
function renderIntegridad() {
  const card = document.getElementById("int-card");
  if (!card) return;
  if (!INT) { card.style.display = "none"; return; }
  const t = INT.totales, f = INT.meta.fechas || {};
  document.getElementById("int-hint").textContent = `sanciones al ${f["sancionados.csv"] || INT.meta.generado}`;
  document.getElementById("kpis-int").innerHTML =
    kpiCard("Con sanción del Tribunal", fmt(t.con_sancion), `de ${fmt(t.proveedores_revisados)} proveedores del Congreso (alguna vez)`, "var(--amber)") +
    kpiCard("Inhabilitados hoy", fmt(t.vigentes), "no pueden contratar con el Estado ahora", "var(--accent)") +
    kpiCard("Contratados durante la sanción", fmt(t.contratados_durante_sancion), t.contratados_durante_sancion ? "adjudicados con inhabilitación vigente" : "ningún caso: el Congreso no adjudicó a un inhabilitado", t.contratados_durante_sancion ? "var(--accent)" : "var(--green)") +
    kpiCard("Personal del Congreso como socio", fmt(t.vinculos), `de proveedores del Congreso · RNP a ${f["Socios.csv"] || "—"}`, "var(--accent-2)");
  const filas = INT.proveedores.filter(p => p.sanciones.length);
  document.querySelector("#tInt tbody").innerHTML = filas.map(p =>
    `<tr><td><b>${esc(p.nombre)}</b>${p.vigente ? ` <span class="tag fis">inhabilitado hoy</span>` : ""}<div class="note" style="margin:2px 0 0">RUC <span class="code">${esc(p.ruc)}</span></div></td>
      <td class="num-r"><b>${soles(p.monto_congreso)}</b><div class="note" style="margin:0">${p.procesos_congreso} proceso${p.procesos_congreso > 1 ? "s" : ""}</div></td>
      <td><ul style="margin:0;padding-left:16px">${p.sanciones.map(s => `<li><b>${s.tipo}</b> ${s.inicio || "?"} → ${s.fin || "definitiva"}${s.monto ? ` · ${soles(s.monto)}` : ""} · <span class="code">${esc(s.resolucion)}</span><div class="note" style="margin:0">${esc(s.motivo)}</div></li>`).join("")}</ul>
      ${p.durante_sancion.length ? `<div class="tag fis">⚠ ${p.durante_sancion.length} proceso(s) con el Congreso durante la inhabilitación</div>` : ""}</td></tr>`).join("");
  document.getElementById("int-nota").innerHTML =
    `Fuente: <a href="${esc(INT.meta.url)}" target="_blank" rel="noopener">datos abiertos del OECE</a> (inhabilitaciones al ${esc(f["sancionados.csv"] || "—")}, multas al ${esc(f["sancionados_multa.csv"] || "—")}). ` +
    `Que un proveedor haya sido sancionado <b>no impide</b> que vuelva a contratar una vez cumplida la sanción; lo grave sería adjudicarle durante la inhabilitación (columna en rojo si ocurre). ` +
    `El cruce de socios, representantes y directivos de estos proveedores con la planilla del Congreso no encontró coincidencias de nombre, pero el OECE publica ese padrón solo con corte a ${esc(f["Socios.csv"] || "2021")}. ` +
    `El registro de sanciones a servidores civiles (RNSSC) de datos abiertos viene anonimizado, así que no permite revisar al personal.`;
}

function pintarProcesos() {
  const q = conState.q.trim().toLowerCase();
  const filas = CON.procesos.filter(p => (!conState.anio || (p.convocado || "").startsWith(conState.anio)) &&
    (!conState.unico || p.postores === 1) &&
    (!q || `${p.objeto} ${p.nomenclatura} ${p.proveedores.join(" ")}`.toLowerCase().includes(q)));
  document.getElementById("con-count").textContent = `${fmt(filas.length)} procesos · ${millon(filas.reduce((a, p) => a + (p.monto || 0), 0))}`;
  document.querySelector("#tConProc tbody").innerHTML = filas.slice(0, 300).map(p =>
    `<tr><td style="white-space:nowrap">${esc(p.convocado || "")}</td>
      <td>${esc(p.objeto)}<div class="note" style="margin:2px 0 0">${esc(p.metodo)} · <span class="code">${esc(p.nomenclatura)}</span></div></td>
      <td>${p.proveedores.map(esc).join("<br>") || `<span class="note">—</span>`}</td>
      <td class="num-r">${p.postores ?? "—"}${p.postores === 1 ? ` <span class="tag fis">único</span>` : ""}</td>
      <td class="num-r">${p.monto ? `<b>${soles(p.monto)}</b>` : "—"}</td></tr>`).join("") +
    (filas.length > 300 ? `<tr><td colspan="5" class="note">Mostrando 300 de ${fmt(filas.length)}: usa el buscador o el filtro de año.</td></tr>` : "");
}

function renderAll() {
  if (!DATA || !CTX) return;
  renderResumen(); renderProyectos(); renderPresupuesto(); renderIncremento();
  renderComisiones(); renderAnalisis(); renderPersonal(); renderMovimientos(); renderEstado(); renderInforme();
  renderBicameral(); renderContratos(); renderIntegridad();
}

// Revalidar con el servidor (ETag) para no servir datos viejos de caché:
// el dashboard se regenera a diario y debe reflejar el snapshot más reciente.
const nocache = { cache: "no-cache" };
Promise.all([
  fetch("data.json", nocache).then(r => r.json()),
  fetch("context.json", nocache).then(r => r.json()),
  fetch("personal.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("bicameral.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("plenos.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("movimientos.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("contratos.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("integridad.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("visitas.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("perfiles.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("asesores.json", nocache).then(r => r.ok ? r.json() : null).catch(() => null),
])
  .then(([d, c, p, b, pl, mv, co, it, vi, pf, as]) => {
    VIS = vi; PERF = pf; ASE = as;
    DATA = d; CTX = c; PERSONAL = p; BIC = b; PLENOS = pl; MOV = mv; CON = co; INT = it;
    document.getElementById("gen").textContent = "actualizado " + d.meta.generado;
    const ud = document.getElementById("updated-date");
    if (ud) ud.textContent = d.meta.generado;
    renderAll();
    aplicarRuta(true);
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
// Enlaces profundos:
//   #bicameral?cam=D|S&banc=<bancada>&q=<texto>&c=<slug>   (c despliega y enfoca a un congresista)
//             &eje=<eje>&com=<comisión>&est=<estado>&rf=0|1&pq=<texto>   (lista de proyectos)
//   #contratos?q=<texto>&anio=<aaaa>     #personal?q=<texto>
function leerHash() {
  const h = (location.hash || "").replace(/^#/, "");
  const i = h.indexOf("?");
  let view = i < 0 ? h : h.slice(0, i);
  try { view = decodeURIComponent(view); } catch (_) { /* hash malformado */ }
  return { view, params: new URLSearchParams(i < 0 ? "" : h.slice(i + 1)) };
}
function hashDe(view) {
  const p = new URLSearchParams();
  if (view === "bicameral") {
    if (bicCam !== "D") p.set("cam", bicCam);
    if (bicState.banc) p.set("banc", bicState.banc);
    if (bicState.q.trim()) p.set("q", bicState.q.trim());
    if (bicProy.eje) p.set("eje", bicProy.eje);
    if (bicProy.com) p.set("com", bicProy.com);
    if (bicProy.est) p.set("est", bicProy.est);
    if (bicProy.rf) p.set("rf", bicProy.rf);
    if (bicProy.q.trim()) p.set("pq", bicProy.q.trim());
    const u = bicState.ultimo && bicState.abiertos.has(bicState.ultimo) && BIC?.congresistas.find(m => m.nombre === bicState.ultimo && m.camara === bicCam);
    if (u) { p.set("cam", bicCam); p.set("c", slugify(u.nombre)); }
  } else if (view === "contratos") {
    if (conState.q.trim()) p.set("q", conState.q.trim());
    if (conState.anio) p.set("anio", conState.anio);
  } else if (view === "personal") {
    if (perState.q.trim()) p.set("q", perState.q.trim());
  }
  const qs = p.toString();
  return view + (qs ? "?" + qs : "");
}
// Reescribe el hash de la vista activa sin crear entradas en el historial.
function syncHash() {
  const v = document.querySelector(".menu button.active")?.dataset.view;
  if (!v) return;
  const h = hashDe(v);
  if (location.hash.replace(/^#/, "") !== h) history.replaceState(null, "", "#" + h);
}
// Aplica el hash a la vista y sus filtros. Sin parámetros solo cambia de pestaña (conserva filtros).
function aplicarRuta(inicial = false) {
  const { view, params } = leerHash();
  if (view === "comparar") { if (DATA && typeof cmpRuta === "function") cmpRuta(params); return; }   // web/comparar.js
  if (!view || !document.querySelector(`.menu button[data-view="${CSS.escape(view)}"]`)) return;
  const c = params.get("c");
  activar(view, !inicial && !c);
  if (![...params.keys()].length || !DATA) return;
  if (view === "bicameral" && BIC) {
    let cam = params.get("cam"), banc = params.get("banc") || "", q = params.get("q") || "";
    const m = c ? congPorSlug(c) : null;
    if (m) {
      cam = m.camara;
      if (banc && banc !== m.bancada) banc = "";
      if (q && !(m.nombre + " " + m.distrito).toLowerCase().includes(q.toLowerCase())) q = "";
      bicState.abiertos.add(m.nombre);
      bicState.ultimo = m.nombre;
      bicState.foco = m.nombre;
    }
    bicCam = cam === "S" ? "S" : "D";
    if (banc && !BIC.congresistas.some(x => x.camara === bicCam && x.bancada === banc)) banc = "";
    bicState.banc = banc; bicState.q = q; bicState.pag = 0;
    document.getElementById("bic-q").value = q;
    // Filtros de la lista de proyectos (se validan contra la cámara en renderBicProyectos)
    bicProy.eje = params.get("eje") || ""; bicProy.com = params.get("com") || ""; bicProy.est = params.get("est") || "";
    bicProy.rf = ["0", "1"].includes(params.get("rf")) ? params.get("rf") : ""; bicProy.q = params.get("pq") || ""; bicProy.pag = 0;
    renderBicameral();
  } else if (view === "contratos" && CON) {
    conState.q = params.get("q") || "";
    const anio = params.get("anio") || "";
    conState.anio = CON.por_anio[anio] ? anio : "";
    document.getElementById("con-q").value = conState.q;
    document.getElementById("con-anio").value = conState.anio;
    pintarProcesos();
  } else if (view === "personal" && PERSONAL) {
    perState.q = params.get("q") || ""; perState.pag = 0;
    document.getElementById("per-q").value = perState.q;
    renderBuscadorPersonal();
  }
}
document.querySelectorAll(".menu button").forEach(btn => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    history.pushState(null, "", "#" + hashDe(v));
    activar(v);
  });
});
window.addEventListener("hashchange", () => aplicarRuta(false));
{ const v = leerHash().view; if (v) activar(v, false); }

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
