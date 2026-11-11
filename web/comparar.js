/* Congreso Abierto Perú — modo "comparar congresistas" (hasta 4, de cualquier cámara).
   Usa los datos y ayudantes globales de app.js (BIC, PLENOS, MOV, VIS, PERF, bicIndices, visDe, perfDe,
   disciplina, soles, fmt, pctTxt, esc, slugify, congPorSlug, palette, opts, scales, mk).
   Enlace profundo: #comparar?c=slug1,slug2,…  */

const CMP_MAX = 4;
const cmpSel = [];          // slugs seleccionados, en orden de selección
let cmpAbierto = false, cmpWired = false;

const cmpMiembro = (sl) => congPorSlug(sl);

// Casilla para la primera celda de cada fila de #tBicMiembros (hook en renderBicMiembros).
function cmpCheck(m) {
  const sl = slugify(m.nombre), on = cmpSel.includes(sl);
  const lleno = !on && cmpSel.length >= CMP_MAX;
  return `<input type="checkbox" class="cmp-chk" data-s="${esc(sl)}"${on ? " checked" : ""}${lleno ? " disabled" : ""} title="${lleno ? `Máximo ${CMP_MAX} para comparar` : "Seleccionar para comparar"}" aria-label="Comparar a ${esc(m.nombre)}">`;
}

function cmpInit() {
  if (cmpWired) return;
  cmpWired = true;
  const bar = document.createElement("div");
  bar.id = "cmp-bar"; bar.className = "cmp-bar"; bar.hidden = true;
  bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Selección para comparar");
  bar.innerHTML = `<button type="button" class="btn cmp-go" id="cmp-go">⚖️ Comparar (0)</button><button type="button" class="btn" id="cmp-clear">Limpiar</button>`;
  document.body.appendChild(bar);
  const ov = document.createElement("div");
  ov.id = "cmp-modal"; ov.className = "cmp-ov"; ov.hidden = true;
  ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "cmp-title");
  ov.innerHTML = `<div class="cmp-box"><div class="cmp-hd"><h3 id="cmp-title">⚖️ Comparar congresistas</h3>
    <button type="button" class="btn" id="cmp-link">🔗 Copiar enlace</button><button type="button" class="btn" id="cmp-close" aria-label="Cerrar">✕</button></div>
    <div class="cmp-body" id="cmp-body"></div></div>`;
  document.body.appendChild(ov);

  document.addEventListener("change", e => {
    const c = e.target.closest?.(".cmp-chk");
    if (!c) return;
    cmpToggle(c.dataset.s, c.checked);
  });
  document.getElementById("cmp-go").addEventListener("click", () => cmpAbrir());
  document.getElementById("cmp-clear").addEventListener("click", () => { cmpSel.length = 0; cmpSync(); });
  document.getElementById("cmp-close").addEventListener("click", cmpCerrar);
  document.getElementById("cmp-link").addEventListener("click", e => cmpCopiar(e.currentTarget));
  ov.addEventListener("click", e => { if (e.target === ov) cmpCerrar(); });
  ov.addEventListener("click", e => {
    const q = e.target.closest(".cmp-quitar");
    if (!q) return;
    const i = cmpSel.indexOf(q.dataset.s);
    if (i >= 0) cmpSel.splice(i, 1);
    cmpSync();
    if (cmpSel.length) cmpRender(); else cmpCerrar();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && cmpAbierto) cmpCerrar(); });
  // El botón de tema repinta los gráficos de app.js; repintar también el del panel.
  document.getElementById("theme")?.addEventListener("click", () => { if (cmpAbierto) setTimeout(cmpRender, 0); });
  window.addEventListener("resize", cmpAjustarBarra);
}

function cmpToggle(sl, on) {
  const i = cmpSel.indexOf(sl);
  if (on && i < 0 && cmpSel.length < CMP_MAX && cmpMiembro(sl)) cmpSel.push(sl);
  if (!on && i >= 0) cmpSel.splice(i, 1);
  cmpSync();
}

// Refleja la selección en la barra y en las casillas visibles.
function cmpSync() {
  cmpInit();
  const bar = document.getElementById("cmp-bar");
  bar.hidden = !cmpSel.length;
  document.getElementById("cmp-go").textContent = `⚖️ Comparar (${cmpSel.length})`;
  document.getElementById("cmp-go").disabled = cmpSel.length < 1;
  document.querySelectorAll("#tBicMiembros .cmp-chk").forEach(c => {
    const on = cmpSel.includes(c.dataset.s);
    c.checked = on;
    c.disabled = !on && cmpSel.length >= CMP_MAX;
    c.title = c.disabled ? `Máximo ${CMP_MAX} para comparar` : "Seleccionar para comparar";
  });
  cmpAjustarBarra();
}

// Deja la barra a la izquierda del botón flotante "Buscar / Preguntar" (bot.js) sin taparlo.
function cmpAjustarBarra() {
  const bar = document.getElementById("cmp-bar");
  if (!bar || bar.hidden) return;
  const fab = document.getElementById("capb-fab");
  bar.style.bottom = ""; bar.style.maxWidth = "";
  if (!fab || !fab.offsetWidth) return;
  // ¿Cabe a la izquierda del botón? Si no (móvil angosto), se apila justo encima de él.
  const libre = fab.getBoundingClientRect().left - 10 - bar.getBoundingClientRect().left;
  if (bar.scrollWidth > libre) bar.style.bottom = `${window.innerHeight - fab.getBoundingClientRect().top + 8}px`;
  else bar.style.maxWidth = `${libre}px`;
}

const cmpMediana = (xs) => {
  const v = xs.filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = Math.floor(v.length / 2);
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
};
const cmpProm = (xs) => { const v = xs.filter(x => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const cmpNum = (x, dec = 0) => x == null ? "—" : new Intl.NumberFormat("es-PE", { maximumFractionDigits: dec }).format(x);

// Filas de la comparación: valor numérico (para destacar y referencias) y presentación.
function cmpFilas() {
  const { pl, dp } = bicIndices();
  const P = (m) => pl[m.camara + "|" + m.nombre], D = (m) => dp[m.camara + "|" + m.nombre];
  const presi = (m) => (perfDe(m)?.comisiones || []).filter(c => /^President[ae]\b/i.test(c.cargo)).length;
  const otrosCargos = (m) => (perfDe(m)?.comisiones || []).filter(c => /Vicepres|Secretari/i.test(c.cargo)).length;
  const pct = (x) => x == null ? "—" : pctTxt(+x.toFixed(1));
  return [
    { t: "Proyectos (autor principal)", v: m => m.principal, f: x => cmpNum(x), mejor: "max" },
    { t: "Firmas (coautor)", v: m => m.firmas, f: x => cmpNum(x), mejor: "max" },
    { t: "% de desarrollo", v: m => m.principal ? m.desarrollo / m.principal * 100 : null, f: pct, mejor: "max",
      sub: m => `${fmt(m.desarrollo)} de ${fmt(m.principal)}` },
    { t: "Simbólicos", v: m => m.simbolicos, f: x => cmpNum(x), mejor: "min", nota: "menos es mejor" },
    { t: "Asistencia al Pleno", v: m => P(m)?.pases ? P(m).pct_asistencia : null, f: pct, mejor: "max",
      sub: m => P(m)?.pases ? `${P(m).presente}/${P(m).pases}${P(m).licencia ? ` · ${P(m).licencia} lic.` : ""}` : "" },
    { t: "Votos SI / NO / Abst", v: m => P(m)?.votaciones ? P(m).si + P(m).no + P(m).abst : null, f: x => x == null ? "—" : `${cmpNum(x)} emitidos`, mejor: "max",
      html: m => { const p = P(m); return p?.votaciones ? `<span style="color:var(--green)">${p.si}</span> / <span style="color:var(--accent)">${p.no}</span> / <span style="color:var(--amber)">${p.abst}</span>` : "—"; },
      sub: m => P(m)?.votaciones ? `${P(m).no_voto} sin votar de ${P(m).votaciones}` : "", nota: "destaca más votos emitidos" },
    { t: "% con su bancada", v: m => disciplina(P(m)), f: pct, mejor: null,
      sub: m => P(m) && disciplina(P(m)) != null ? `${P(m).contra_bancada} en contra` : "", nota: "sin juicio de valor" },
    { t: "Visitas al despacho", v: m => visDe(m)?.total ?? null, f: x => cmpNum(x), mejor: null,
      sub: m => visDe(m) ? `${fmt(visDe(m).al_congresista)} a él/ella` : "" },
    { t: "Personal del despacho", v: m => D(m)?.personal ?? null, f: x => cmpNum(x, 1), mejor: null },
    { t: "Planilla mensual del despacho", v: m => D(m)?.masa ?? null, f: x => x == null ? "—" : soles(x), mejor: "min", nota: "menos gasto" },
    { t: "Comisiones", v: m => perfDe(m) ? perfDe(m).comisiones.length : null, f: x => cmpNum(x, 1), mejor: "max" },
    { t: "Presidencias de comisión", v: m => perfDe(m) ? presi(m) : null, f: x => cmpNum(x, 1), mejor: "max",
      sub: m => perfDe(m) && otrosCargos(m) ? `+${otrosCargos(m)} vice/secretaría` : "" },
  ];
}

function cmpRender() {
  const body = document.getElementById("cmp-body");
  const ms = cmpSel.map(cmpMiembro).filter(Boolean);
  if (!ms.length) { body.innerHTML = `<div class="note">Selecciona hasta ${CMP_MAX} congresistas con las casillas de la tabla.</div>`; return; }
  const filas = cmpFilas();
  const todos = BIC.congresistas;
  const camN = (c) => c === "S" ? "Senado" : "Diputados";
  const head = ms.map(m => {
    const pf = perfDe(m), sl = slugify(m.nombre);
    return `<th class="cmp-col" scope="col"><div class="cmp-who">
      ${pf?.foto ? `<img src="${esc(pf.foto)}" alt="" loading="lazy" width="56" height="56">` : `<span class="cmp-nofoto" aria-hidden="true">👤</span>`}
      <a href="congresistas/${esc(sl)}.html">${esc(m.nombre)}</a>
      <span class="note"><span class="tag">${esc(m.sigla)}</span> ${esc(m.bancada)}</span>
      <span class="note">${esc(m.distrito)} · ${camN(m.camara)}</span>
      <button type="button" class="cmp-quitar" data-s="${esc(sl)}" aria-label="Quitar a ${esc(m.nombre)}">quitar ✕</button></div></th>`;
  }).join("");
  const rows = filas.map(r => {
    const vals = ms.map(m => r.v(m));
    const ok = vals.filter(x => x != null);
    let best = null;
    if (r.mejor && ok.length > 1 && new Set(ok).size > 1) best = r.mejor === "max" ? Math.max(...ok) : Math.min(...ok);
    const celdas = ms.map((m, i) => {
      const x = vals[i];
      const mc = todos.filter(o => o.camara === m.camara);
      const med = cmpMediana(mc.map(r.v));
      const bp = cmpProm(mc.filter(o => o.bancada === m.bancada).map(r.v));
      const sub = r.sub ? r.sub(m) : "";
      const top = best != null && x === best;
      return `<td class="${top ? "cmp-best" : ""}">${top ? `<span class="sr">mejor: </span>` : ""}<b>${r.html ? r.html(m) : r.f(x)}</b>${sub ? `<div class="note">${esc(sub)}</div>` : ""}
        <div class="note cmp-ref" title="Mediana de ${camN(m.camara)} · promedio de su bancada en esa cámara">med. ${esc(camN(m.camara).slice(0, 3))}: ${esc(r.f(med))} · prom. ${esc(m.sigla)}: ${esc(r.f(bp))}</div></td>`;
    }).join("");
    return `<tr><th scope="row">${esc(r.t)}${r.nota ? `<div class="note">${esc(r.nota)}</div>` : ""}</th>${celdas}</tr>`;
  }).join("");
  body.innerHTML = `<div class="cmp-scroll"><table class="cmp-t"><thead><tr><th scope="col"><span class="note">Indicador</span></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note">Resaltado = mejor valor de la fila entre los seleccionados (cuando hay diferencia). Debajo de cada valor: mediana de su cámara y promedio de su bancada en esa cámara. Asistencia y votos: Pleno; despacho: planilla del PTE del último mes; visitas: registro oficial; comisiones: web de cada cámara.</div>
    <h4 class="cmp-h4">🧭 Temáticas de sus proyectos (autor principal)</h4>
    <div class="cmp-chart"><canvas id="cmp-temas" role="img" aria-label="Proyectos por temática de cada congresista seleccionado"></canvas></div>
    <div class="note">Eje de cada proyecto según palabras clave del título (indicativo).</div>`;
  // Gráfico de barras agrupadas: temáticas × congresista
  const cuenta = ms.map(m => (m.proyectos || []).reduce((a, x) => (a[x.agenda] = (a[x.agenda] || 0) + 1, a), {}));
  const tot = {};
  cuenta.forEach(c => Object.entries(c).forEach(([k, n]) => { tot[k] = (tot[k] || 0) + n; }));
  const temas = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, 8);
  const box = body.querySelector(".cmp-chart");
  if (!temas.length) { box.outerHTML = `<div class="note">Ninguno tiene proyectos como autor principal.</div>`; return; }
  box.style.height = Math.max(220, temas.length * (28 + ms.length * 8)) + "px";
  const col = palette(ms.length);
  const corto = (s) => s.length > 30 ? s.slice(0, 30) + "…" : s;
  if (typeof Chart === "undefined") return;
  mk("cmp-temas", {
    type: "bar",
    data: { labels: temas.map(corto), datasets: ms.map((m, i) => ({
      label: m.nombre.split(",")[0], data: temas.map(t => cuenta[i][t] || 0), backgroundColor: col[i], borderRadius: 3, maxBarThickness: 14,
    })) },
    options: opts({ indexAxis: "y", scales: scales(true),
      plugins: { legend: { position: "top", labels: { color: textC(), boxWidth: 12, font: { family: "Inter", size: 11 } } },
        tooltip: { backgroundColor: "#000", padding: 10, cornerRadius: 8, callbacks: { title: (it) => temas[it[0].dataIndex] } } } }),
  });
}

function cmpHash() { return "comparar?c=" + cmpSel.join(","); }

function cmpAbrir() {
  cmpInit();
  if (!cmpSel.length) return;
  cmpAbierto = true;
  const ov = document.getElementById("cmp-modal");
  ov.hidden = false;
  document.body.classList.add("cmp-lock");
  cmpRender();
  history.replaceState(null, "", "#" + cmpHash());
  document.getElementById("cmp-close").focus({ preventScroll: true });
}

function cmpCerrar() {
  if (!cmpAbierto) return;
  cmpAbierto = false;
  document.getElementById("cmp-modal").hidden = true;
  document.body.classList.remove("cmp-lock");
  if (CHARTS["cmp-temas"]) { CHARTS["cmp-temas"].destroy(); delete CHARTS["cmp-temas"]; }
  if (leerHash().view === "comparar") history.replaceState(null, "", "#" + hashDe("bicameral"));
}

async function cmpCopiar(btn) {
  const url = `${location.origin}${location.pathname}#${cmpHash()}`;
  const txt = btn.textContent;
  try { await navigator.clipboard.writeText(url); btn.textContent = "✅ Enlace copiado"; }
  catch (e) {
    try { window.prompt("Copia este enlace:", url); } catch (_) { /* sin diálogo */ }
    btn.textContent = "Copia el enlace manualmente";
  }
  setTimeout(() => { btn.textContent = txt; }, 2000);
}

// Hook del router (aplicarRuta): #comparar?c=slug1,slug2,…
function cmpRuta(params) {
  if (!BIC) return;
  const sls = (params.get("c") || "").split(",").map(s => s.trim()).filter(Boolean);
  cmpSel.length = 0;
  sls.forEach(s => { if (!cmpSel.includes(s) && cmpSel.length < CMP_MAX && cmpMiembro(s)) cmpSel.push(s); });
  activar("bicameral", false);
  const m0 = cmpMiembro(cmpSel[0] || "");
  if (m0 && m0.camara !== bicCam) { bicCam = m0.camara; bicState.banc = ""; bicState.pag = 0; renderBicameral(); }
  cmpSync();
  if (cmpSel.length) cmpAbrir(); else history.replaceState(null, "", "#" + hashDe("bicameral"));
}
