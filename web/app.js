/* Congreso Abierto Perú — dashboard estático sobre data.json (periodo 2021–2026). */

const fmt = (n) => new Intl.NumberFormat("es-PE").format(n);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let CHARTS = [];

function paletteFor(n) {
  const base = ["#e23744", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7",
    "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#6366f1", "#eab308"];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}

function gridColor() { return css("--border"); }
function textColor() { return css("--muted"); }

function commonOpts(extra = {}) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: textColor(), font: { family: "Inter", size: 12 } } },
      tooltip: { backgroundColor: "#000", padding: 10, cornerRadius: 8 },
    },
  }, extra);
}

function scales(horizontal = false) {
  const axis = {
    grid: { color: gridColor(), drawBorder: false },
    ticks: { color: textColor(), font: { family: "Inter", size: 11 } },
    border: { display: false },
  };
  return horizontal ? { x: axis, y: Object.assign({}, axis, { grid: { display: false } }) }
                    : { y: axis, x: Object.assign({}, axis, { grid: { display: false } }) };
}

function renderKpis(d) {
  const tasa = ((d.totales.leyes_aprobadas / d.totales.proyectos) * 100).toFixed(1);
  const items = [
    { label: "Proyectos de ley", num: fmt(d.totales.proyectos), meta: "presentados en el periodo" },
    { label: "Leyes aprobadas", num: fmt(d.totales.leyes_aprobadas), meta: `<b>${tasa}%</b> llegó a publicarse` },
    { label: "Autores activos", num: fmt(d.totales.autores_unicos), meta: "congresistas firmantes" },
    { label: "Periodo", num: "2021–26", meta: "parlamento vigente" },
  ];
  document.getElementById("kpis").innerHTML = items.map((k) => `
    <div class="card kpi">
      <div class="label">${k.label}</div>
      <div class="num">${k.num}</div>
      <div class="meta">${k.meta}</div>
    </div>`).join("");
}

function renderTable(d) {
  const rows = d.recientes.map((p) => {
    const ley = /PUBLICAD|PROMULGAD|AUTÓGRAFA|AUTOGRAFA/i.test(p.estado);
    return `<tr>
      <td class="code">${p.codigo}</td>
      <td>${p.titulo.charAt(0) + p.titulo.slice(1).toLowerCase()}</td>
      <td><span class="tag ${ley ? "ley" : ""}">${p.estado}</span></td>
      <td>${p.fecha || "—"}</td>
      <td>${p.autores}</td>
    </tr>`;
  }).join("");
  document.querySelector("#tabla tbody").innerHTML = rows;
}

function buildCharts(d) {
  CHARTS.forEach((c) => c.destroy());
  CHARTS = [];

  // Por año
  CHARTS.push(new Chart(document.getElementById("chAnio"), {
    type: "bar",
    data: {
      labels: Object.keys(d.por_anio),
      datasets: [{ label: "Proyectos", data: Object.values(d.por_anio),
        backgroundColor: css("--accent"), borderRadius: 6, maxBarThickness: 64 }],
    },
    options: commonOpts({ plugins: { legend: { display: false } }, scales: scales() }),
  }));

  // Por proponente (doughnut)
  const propL = Object.keys(d.por_proponente), propV = Object.values(d.por_proponente);
  CHARTS.push(new Chart(document.getElementById("chProp"), {
    type: "doughnut",
    data: { labels: propL, datasets: [{ data: propV, backgroundColor: paletteFor(propL.length), borderWidth: 0 }] },
    options: commonOpts({ cutout: "62%", plugins: {
      legend: { position: "bottom", labels: { color: textColor(), boxWidth: 12, font: { size: 11 } } },
    } }),
  }));

  // Por estado (barra horizontal)
  const estL = Object.keys(d.por_estado), estV = Object.values(d.por_estado);
  CHARTS.push(new Chart(document.getElementById("chEstado"), {
    type: "bar",
    data: { labels: estL, datasets: [{ data: estV, backgroundColor: css("--accent-2"), borderRadius: 6 }] },
    options: commonOpts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  }));

  // Top autores
  const aut = d.top_autores.slice(0, 14);
  CHARTS.push(new Chart(document.getElementById("chAutor"), {
    type: "bar",
    data: { labels: aut.map((a) => a.nombre), datasets: [{ data: aut.map((a) => a.proyectos),
      backgroundColor: css("--green"), borderRadius: 6 }] },
    options: commonOpts({ indexAxis: "y", plugins: { legend: { display: false } }, scales: scales(true) }),
  }));
}

let DATA = null;
function renderAll() { if (!DATA) return; renderKpis(DATA); renderTable(DATA); buildCharts(DATA); }

fetch("data.json")
  .then((r) => r.json())
  .then((d) => {
    DATA = d;
    document.getElementById("gen").textContent = "actualizado " + d.meta.generado;
    renderAll();
  })
  .catch((e) => {
    document.getElementById("kpis").innerHTML =
      `<div class="card">No se pudo cargar data.json (${e}).</div>`;
  });

// Tema
const themeBtn = document.getElementById("theme");
const saved = localStorage.getItem("cap-theme");
if (saved) document.documentElement.setAttribute("data-theme", saved);
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("cap-theme", next);
  renderAll(); // recolorea charts según el tema
});
