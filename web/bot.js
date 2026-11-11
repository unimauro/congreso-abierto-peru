/* Congreso Abierto Perú — Buscador global + bot de preguntas (reglas, sin LLM, sin backend).
   Lee los JSON publicados en esta misma carpeta. Autocontenido: inyecta su propio CSS. */
(function () {
  "use strict";
  if (window.__capBot) return;
  window.__capBot = true;

  /* ───────────── utilidades ───────────── */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const deacc = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const norm = s => deacc(s).toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").replace(/ñ/g, "n").trim();
  const words = s => norm(s).split(" ").filter(Boolean);
  // Igual que web/build_seo.py: NFKD → ascii → minúsculas → no-alfanumérico a '-'
  const slug = s => String(s || "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const nf = new Intl.NumberFormat("es-PE");
  const fmt = n => nf.format(n || 0);
  const soles = n => "S/ " + new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
  const pct = n => (n == null ? "—" : String(n).replace(".", ",") + "%");
  const CAM = { D: "Cámara de Diputados", S: "Senado", C: "Congreso (bicameral)" };
  const CAMC = { D: "Diputados", S: "Senado", C: "Bicameral" };
  const fecha = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || ""); };
  const mesTxt = s => { const M = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"]; const m = /^(\d{4})-(\d{2})/.exec(s || ""); return m ? `${M[+m[2] - 1]} ${m[1]}` : (s || ""); };
  const nombreNat = n => { const p = String(n || "").split(","); return p.length > 1 ? (p[1].trim() + " " + p[0].trim()) : String(n || ""); };

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  // puntaje de un token de la consulta contra las palabras de un ítem
  function tokScore(t, ws, hay) {
    let s = 0;
    for (const w of ws) {
      if (w === t) return 4;
      if (w.startsWith(t)) s = Math.max(s, t.length >= 3 ? 3 : 1);
    }
    if (s) return s;
    if (t.length >= 3 && hay.includes(t)) return 2;
    if (t.length >= 4) {
      const max = t.length >= 7 ? 2 : 1;
      for (const w of ws) {
        if (w.length < 3) continue;
        if (lev(t, w, max) <= max || (w.length > t.length && lev(t, w.slice(0, t.length), max) <= max)) return 1;
      }
    }
    return 0;
  }

  /* ───────────── datos ───────────── */
  let DATA = null, loading = null;
  const getJSON = f => fetch(f, { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  function load() {
    if (DATA) return Promise.resolve(DATA);
    if (loading) return loading;
    loading = Promise.all(["bicameral.json", "plenos.json", "movimientos.json", "contratos.json", "integridad.json"].map(getJSON))
      .then(([bi, pl, mov, con, integ]) => { DATA = index({ bi, pl, mov, con, integ }); return DATA; });
    return loading;
  }

  function index(R) {
    const D = { R, cong: [], proy: [], prov: [], com: [], byName: {} };
    const asis = {}, desp = {};
    (R.pl?.miembros || []).forEach(m => { asis[m.camara + "|" + m.nombre] = m; });
    (R.mov?.despachos || []).forEach(m => { desp[m.camara + "|" + m.nombre] = m; });
    const seen = {};
    (R.bi?.congresistas || []).forEach(c => {
      const k = c.camara + "|" + c.nombre;
      const it = { type: "cong", c, a: asis[k] || null, d: desp[k] || null, slug: slug(c.nombre) };
      it.ws = words(c.nombre + " " + c.distrito + " " + c.bancada + " " + (c.sigla || ""));
      it.nameWs = words(c.nombre).filter(w => w.length >= 3 && !NAME_STOP.has(w));
      it.hay = it.ws.join(" ");
      D.cong.push(it); D.byName[k] = it;
      (c.proyectos || []).forEach(p => {
        if (seen[p.codigo]) return;
        const q = { type: "proy", p: Object.assign({ camara: c.camara }, p), autor: it };
        q.ws = words(p.codigo + " " + p.titulo); q.hay = q.ws.join(" ");
        seen[p.codigo] = q; D.proy.push(q);
      });
    });
    (R.bi?.recientes || []).forEach(p => {
      if (seen[p.codigo]) return;
      const q = { type: "proy", p, autor: null };
      q.ws = words(p.codigo + " " + p.titulo); q.hay = q.ws.join(" ");
      seen[p.codigo] = q; D.proy.push(q);
    });
    D.proyByCode = seen;
    // proveedores: lista top de contratos + nombres + integridad
    const sanc = {};
    (R.integ?.proveedores || []).forEach(p => { sanc[p.ruc] = p; });
    const top = {};
    (R.con?.proveedores || []).forEach(p => { top[p.ruc] = p; });
    const nombres = Object.assign({}, R.con?.nombres || {});
    (R.integ?.proveedores || []).forEach(p => { if (!nombres[p.ruc]) nombres[p.ruc] = p.nombre; });
    Object.keys(nombres).forEach(ruc => {
      let monto, procesos, aprox = false;
      if (top[ruc]) { monto = top[ruc].monto; procesos = top[ruc].procesos; }
      else {
        monto = 0; procesos = 0;
        (R.con?.procesos || []).forEach(pr => {
          if ((pr.rucs || []).includes(ruc)) { procesos++; if (pr.rucs.length === 1) monto += pr.monto || 0; else aprox = true; }
        });
        if (!procesos && sanc[ruc]) { monto = sanc[ruc].monto_congreso || 0; procesos = sanc[ruc].procesos_congreso || 0; }
      }
      const it = { type: "prov", ruc, nombre: nombres[ruc], monto, procesos, aprox, s: sanc[ruc] || null };
      it.ws = words(it.nombre + " " + ruc); it.hay = it.ws.join(" ");
      it.sigWs = words(it.nombre).filter(w => w.length >= 3 && !PROV_STOP.has(w));
      D.prov.push(it);
    });
    ["D", "S"].forEach(cam => (R.bi?.camaras?.[cam]?.comisiones || []).forEach(cm => {
      const it = { type: "com", cam, nombre: cm.nombre, proyectos: cm.proyectos };
      it.ws = words(cm.nombre + " comision"); it.hay = it.ws.join(" ");
      D.com.push(it);
    }));
    return D;
  }

  /* ───────────── búsqueda difusa ───────────── */
  const Q_STOP = new Set("de del la el los las y o a en con por para que quien quienes cual cuales cuanto cuanta cuantos cuantas como es son un una al se su sus lo le me mi".split(" "));
  const NAME_STOP = new Set(["del", "las", "los", "san", "santa"]);
  const PROV_STOP = new Set("sac s a eirl srl sa sociedad anonima comercial peru peruana del de la los las compania cia empresa servicios generales corporacion grupo ltda limitada cerrada y e contratistas negocios inversiones".split(" "));

  function searchList(list, toks, n) {
    const out = [];
    for (const it of list) {
      let s = 0, hits = 0;
      for (const t of toks) { const v = tokScore(t, it.ws, it.hay); if (v) { s += v; hits++; } }
      if (!hits) continue;
      const need = toks.length <= 2 ? toks.length : Math.ceil(toks.length * 0.6);
      if (hits < need) continue;
      out.push({ it, s: s + hits * 2 });
    }
    out.sort((a, b) => b.s - a.s || (b.it.c?.principal || b.it.monto || b.it.proyectos || 0) - (a.it.c?.principal || a.it.monto || a.it.proyectos || 0));
    return out.slice(0, n).map(x => x.it);
  }
  function search(q, n = 5) {
    const toks = words(q).filter(t => !Q_STOP.has(t));
    if (!toks.length || !DATA) return null;
    return { cong: searchList(DATA.cong, toks, n), proy: searchList(DATA.proy, toks, n), prov: searchList(DATA.prov, toks, n), com: searchList(DATA.com, toks, n) };
  }

  /* ───────────── entidades dentro de una pregunta ───────────── */
  const INTENT_WORDS = new Set(("proyecto proyectos presento presentado presentados presenta presentan ley leyes asistencia asiste asistio falta faltas falto ausencia ausencias " +
    "pleno gasta gasto gastos despacho despachos planilla personal asesor asesores trabajadores sueldo sueldos cuesta costo vota voto votos votacion votaciones " +
    "diputado diputada diputados senador senadora senadores senado camara congreso congresista congresistas bancada bancadas partido mas menos top ranking " +
    "quien cuanto cuantos contrato contrataron contratos proveedor proveedores sancionado sancionados sobre tiene tienen hay dime info informacion datos ficha " +
    "perfil buscar busca muestra muestrame ver lista mayor menor primero primeros contra firma firmas autor autoria caro caros cara costoso costosos " +
    "promedio vigente vigentes mejor peor nunca siempre veces cuantas ultimo ultimos recientes").split(" "));

  function findPerson(q) {
    const toks = words(q).filter(t => t.length >= 3 && !Q_STOP.has(t) && !INTENT_WORDS.has(t));
    if (!toks.length || !DATA) return null;
    let best = [], bestS = 0;
    for (const it of DATA.cong) {
      let s = 0;
      for (const t of toks) {
        let v = 0;
        for (const w of it.nameWs) {
          if (w === t) { v = 3; break; }
          if (t.length >= 4 && w.startsWith(t)) v = Math.max(v, 2);
          else if (t.length >= 6 && lev(t, w, 1) <= 1) v = Math.max(v, 2);
        }
        s += v;
      }
      if (s > bestS) { bestS = s; best = [it]; } else if (s === bestS && s > 0) best.push(it);
    }
    if (bestS < 2) return null;
    return { best: best[0], all: best, score: bestS };
  }
  function findProveedor(q) {
    if (!DATA) return null;
    const digits = (q.match(/\d{6,11}/) || [])[0];
    if (digits) { const it = DATA.prov.find(p => p.ruc === digits); if (it) return it; }
    const toks = words(q).filter(t => t.length >= 3 && !Q_STOP.has(t) && !INTENT_WORDS.has(t) && !PROV_STOP.has(t) &&
      !["cuanto", "contrato", "contrataron", "contratado", "pago", "pagado", "pagaron", "compro", "compras", "dinero", "monto", "plata", "sanciones", "sancion", "inhabilitado", "vigente"].includes(t));
    if (!toks.length) return null;
    let best = null, bestS = 0;
    for (const it of DATA.prov) {
      let s = 0;
      for (const t of toks) {
        for (const w of it.sigWs) {
          if (w === t) { s += 3; break; }
          if (t.length >= 4 && (w.startsWith(t) || (t.length >= 5 && lev(t, w, 1) <= 1))) { s += 2; break; }
        }
      }
      if (s > bestS || (s === bestS && s && it.monto > best.monto)) { bestS = s; best = it; }
    }
    return bestS >= 2 ? best : null;
  }
  function camaraDe(qn) {
    if (/\bsenad(o|or|ores|ora|oras)\b/.test(qn)) return "S";
    if (/\bdiputad(o|a|os|as)\b/.test(qn)) return "D";
    return null;
  }
  function topN(qn, def = 5) {
    const m = /\b(?:top|primeros|primeras|los|las)\s+(\d{1,2})\b/.exec(qn) || /\b(\d{1,2})\s+(?:diputad|senador|congresist|bancad|proveedor|despacho)/.exec(qn);
    const n = m ? +m[1] : def;
    return Math.max(1, Math.min(20, n));
  }

  /* ───────────── renderizado ───────────── */
  const congLink = it => `<a class="capb-l" href="congresistas/${esc(it.slug)}.html">${esc(nombreNat(it.c.nombre))}</a>`;
  const congTag = it => `<span class="capb-tag">${esc(it.c.sigla || it.c.bancada || "")}</span>`;
  function src(...keys) {
    const R = DATA.R, parts = [];
    keys.forEach(k => {
      if (k === "bi" && R.bi) parts.push(`Proyectos: API del Congreso (spley) · corte ${esc(R.bi.meta?.generado)}`);
      if (k === "pl" && R.pl) parts.push(`Pleno: reportes de asistencia y votación (PDF) · corte ${esc(R.pl.meta?.generado)}`);
      if (k === "mov" && R.mov) parts.push(`Despachos: planilla nominal PTE · corte ${esc(R.mov.meta?.generado)}`);
      if (k === "con" && R.con) parts.push(`Contratos: OECE/SEACE (OCDS) desde ${esc(mesTxt(R.con.meta?.desde))} · corte ${esc(R.con.meta?.generado)}`);
      if (k === "integ" && R.integ) parts.push(`Sanciones: OECE datos abiertos · corte ${esc(R.integ.meta?.generado)}`);
    });
    return `<div class="capb-src">Fuente: ${parts.join(" · ")}</div>`;
  }
  const table = (head, rows) => `<div class="capb-tw"><table class="capb-t"><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i && /^[\d.,%S/ \-—]+$/.test(String(c).replace(/<[^>]+>/g, "")) ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const ans = (sentence, body, ...s) => `<div class="capb-ans"><p class="capb-s">${sentence}</p>${body || ""}${src(...s)}</div>`;
  const projRow = q => `<li><button type="button" class="capb-pj" data-code="${esc(q.p.codigo)}"><span class="capb-code">${esc(q.p.codigo)}</span> <span class="capb-mut">${esc(fecha(q.p.fecha))}</span><br>${esc(trunc(q.p.titulo, 140))}</button><div class="capb-det" hidden></div></li>`;
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

  function projDetail(q) {
    const p = q.p;
    return `<dl class="capb-dl"><dt>Código</dt><dd>${esc(p.codigo)}</dd><dt>Cámara</dt><dd>${esc(CAM[p.camara] || p.camara || "—")}</dd>` +
      `<dt>Fecha</dt><dd>${esc(fecha(p.fecha))}</dd><dt>Estado</dt><dd>${esc(p.estado || "—")}</dd><dt>Agenda</dt><dd>${esc(p.agenda || "—")}</dd>` +
      (q.autor ? `<dt>Autor</dt><dd>${congLink(q.autor)} ${congTag(q.autor)}</dd>` : p.proponente ? `<dt>Proponente</dt><dd>${esc(p.proponente)}</dd>` : "") +
      `</dl><p class="capb-ttl">${esc(p.titulo)}</p>`;
  }
  function provDetail(it) {
    let h = `<dl class="capb-dl"><dt>RUC</dt><dd>${esc(it.ruc)}</dd><dt>Monto con el Congreso</dt><dd>${soles(it.monto)}${it.aprox ? " (sin contar consorcios)" : ""}</dd><dt>Procesos</dt><dd>${fmt(it.procesos)}</dd></dl>`;
    if (it.s && it.s.sanciones?.length) {
      h += `<p class="capb-warn">${it.s.vigente ? "⚠ Sanción vigente" : "Tuvo sanciones"} (${it.s.sanciones.length})</p><ul class="capb-ul">` +
        it.s.sanciones.map(s => `<li><b>${esc(s.tipo)}</b> ${esc(fecha(s.inicio))} → ${esc(fecha(s.fin))} · Res. ${esc(s.resolucion)}${s.monto ? " · multa " + soles(s.monto) : ""}<br><span class="capb-mut">${esc(trunc(s.motivo, 180))}</span></li>`).join("") + "</ul>";
    } else h += `<p class="capb-mut">Sin sanciones registradas en OECE.</p>`;
    return h;
  }

  function renderSearch(res, q) {
    if (!res) return "";
    const g = [];
    if (res.cong.length) g.push(`<h4>Congresistas</h4><ul class="capb-ul">` + res.cong.map(it =>
      `<li><a class="capb-row" href="congresistas/${esc(it.slug)}.html"><b>${esc(nombreNat(it.c.nombre))}</b> ${congTag(it)}<br><span class="capb-mut">${esc(CAMC[it.c.camara])} · ${esc(it.c.distrito)} · ${fmt(it.c.principal)} proyectos</span></a></li>`).join("") + "</ul>");
    if (res.proy.length) g.push(`<h4>Proyectos</h4><ul class="capb-ul">` + res.proy.map(projRow).join("") + "</ul>");
    if (res.prov.length) g.push(`<h4>Proveedores</h4><ul class="capb-ul">` + res.prov.map(it =>
      `<li><button type="button" class="capb-pv" data-ruc="${esc(it.ruc)}"><b>${esc(it.nombre)}</b>${it.s?.vigente ? ' <span class="capb-tag capb-red">sanción vigente</span>' : it.s ? ' <span class="capb-tag">sancionado</span>' : ""}<br><span class="capb-mut">RUC ${esc(it.ruc)} · ${soles(it.monto)} · ${fmt(it.procesos)} procesos</span></button><div class="capb-det" hidden></div></li>`).join("") + "</ul>");
    if (res.com.length) g.push(`<h4>Comisiones</h4><ul class="capb-ul">` + res.com.map(it =>
      `<li><div class="capb-row"><b>${esc(it.nombre)}</b><br><span class="capb-mut">${esc(CAMC[it.cam])} · ${fmt(it.proyectos)} proyectos derivados</span></div></li>`).join("") + "</ul>");
    if (!g.length) return `<p class="capb-mut">Sin resultados para “${esc(q)}”.</p>`;
    return g.join("");
  }

  /* ───────────── bot: intenciones ───────────── */
  function answer(q) {
    const R = DATA.R, qn = norm(q);
    const has = re => re.test(qn);
    const cam = camaraDe(qn);
    const camTxt = cam ? (cam === "S" ? "en el Senado" : "en la Cámara de Diputados") : "en ambas cámaras";

    // 1) proyectos sobre un tema
    const tm = /\b(?:proyectos?|leyes|iniciativas|propuestas)\b.*?\b(?:sobre|acerca de|relacionad[oa]s? con|en materia de|con el tema|que mencionan?|que hablan de)\s+(.+)$/.exec(qn) ||
      /\b(?:proyectos?|iniciativas|propuestas)\s+(?:de ley\s+)?(?:de|del|en)\s+(.+)$/.exec(qn);
    if (tm && (/\b(sobre|acerca|relacionad|materia|tema|mencionan?|hablan)\b/.test(qn) || (!findPerson(tm[1]) && !/^(la |el |los |las )?(camara|senado|congreso|bancada|diputad|senador|ley$)/.test(tm[1])))) {
      const kw = tm[1].replace(/\b(el|la|los|las|y|o|en|de|del|ley|leyes)\b/g, " ").replace(/\s+/g, " ").trim();
      if (kw && !/^(mas|menos)\b/.test(kw)) return topicSearch(kw, cam);
    }

    // 2) sanciones
    if (has(/sancion|inhabilit|multad|penalidad/)) {
      const pv = findProveedor(q);
      if (pv) return ans(pv.s ? `<b>${esc(pv.nombre)}</b> ${pv.s.vigente ? "tiene una sanción <b>vigente</b>" : "registra sanciones (no vigentes)"} en OECE y contrató ${soles(pv.monto)} con el Congreso.` : `<b>${esc(pv.nombre)}</b> no registra sanciones en OECE.`, provDetail(pv), "con", "integ");
      const t = R.integ?.totales || {};
      let L = (R.integ?.proveedores || []).filter(p => p.sanciones?.length);
      const soloVig = has(/vigente/);
      if (soloVig) L = L.filter(p => p.vigente);
      L.sort((a, b) => (b.vigente - a.vigente) || (b.monto_congreso || 0) - (a.monto_congreso || 0));
      const n = topN(qn, 10);
      return ans(`De ${fmt(t.proveedores_revisados)} proveedores del Congreso revisados, <b>${fmt(t.con_sancion)}</b> tienen sanciones en OECE y <b>${fmt(t.vigentes)}</b> están vigentes. ${soloVig ? "Vigentes" : "Los " + Math.min(n, L.length) + " con más monto contratado"}:`,
        table(["Proveedor", "Vigente", "Sanciones", "Monto Congreso"], L.slice(0, n).map(p => [`<button type="button" class="capb-lk capb-pv-open" data-ruc="${esc(p.ruc)}">${esc(p.nombre)}</button>`, p.vigente ? '<span class="capb-red">Sí</span>' : "No", fmt(p.sanciones.length), soles(p.monto_congreso)])), "integ", "con");
    }

    // 3) contratos / proveedores
    if (has(/\bcontrat|proveedor|\bruc\b|\bpag[oa]|\bcompr[oa]|seace|licitacion/)) {
      const pv = findProveedor(q);
      if (pv) return ans(`El Congreso contrató <b>${soles(pv.monto)}</b> con <b>${esc(pv.nombre)}</b> en ${fmt(pv.procesos)} proceso${pv.procesos === 1 ? "" : "s"} (desde ${esc(mesTxt(R.con?.meta?.desde))}).`, provDetail(pv), "con", "integ");
      if (has(/proveedor|mas|top|quien|ranking|mayor/)) {
        const n = topN(qn, 5), L = (R.con?.proveedores || []).slice().sort((a, b) => b.monto - a.monto).slice(0, n), t = R.con?.totales || {};
        return ans(`El Congreso adjudicó <b>${soles(t.monto)}</b> en ${fmt(t.procesos)} procesos a ${fmt(t.proveedores)} proveedores; los 10 mayores concentran el ${pct(t.top10_pct)}. Top ${n}:`,
          table(["Proveedor", "Procesos", "Monto", "%"], L.map(p => [`<button type="button" class="capb-lk capb-pv-open" data-ruc="${esc(p.ruc)}">${esc(p.nombre)}</button>`, fmt(p.procesos), soles(p.monto), pct(p.pct)])), "con");
      }
    }

    // 4) despacho / gasto en personal
    if (has(/gast|despacho|planilla|asesor|trabajador|sueldo|cuesta|costo|personal|equipo/)) {
      const per = findPerson(q);
      if (per) {
        if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
        const it = per.best, d = it.d;
        if (!d) return ans(`No encontramos el despacho de ${congLink(it)} en la planilla publicada.`, "", "mov");
        const ult = (d.serie || []).slice(-1)[0];
        const eq = (d.equipo || []).slice().sort((a, b) => b.total - a.total);
        return ans(`El despacho de ${congLink(it)} ${congTag(it)} tiene <b>${fmt(d.personal)} personas</b> en planilla y cuesta <b>${soles(d.masa)} al mes</b>${ult ? " (" + esc(mesTxt(ult.mes)) + ")" : ""}${d.continuan ? `; ${fmt(d.continuan)} ya trabajaban en el Congreso` : ""}.`,
          table(["Integrante", "Cargo", "Mensual"], eq.map(e => [esc(e.nombre), esc(e.cargo), soles(e.total)])), "mov");
      }
      if (has(/despacho|gast|cuesta|caro|personal|asesor/)) {
        const n = topN(qn, 5);
        const L = (R.mov?.despachos || []).filter(d => !cam || d.camara === cam).sort((a, b) => b.masa - a.masa);
        const tot = L.reduce((s, d) => s + d.masa, 0);
        return ans(`Los ${fmt(L.length)} despachos ${camTxt} suman <b>${soles(tot)} al mes</b> en planilla (promedio ${soles(tot / (L.length || 1))}). Los ${n} más costosos:`,
          table(["Congresista", "Personas", "Mensual"], L.slice(0, n).map(d => { const it = DATA.byName[d.camara + "|" + d.nombre]; return [it ? congLink(it) + " " + congTag(it) : esc(nombreNat(d.nombre)), fmt(d.personal), soles(d.masa)]; })), "mov");
      }
    }

    // 5) asistencia al Pleno
    if (has(/asist|falt|ausen|inasist|faltón|falton|licencia|\bva al pleno/)) {
      const per = findPerson(q);
      if (per) {
        if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
        const it = per.best, a = it.a;
        if (!a || !a.pases) return ans(`No hay pases de lista del Pleno registrados para ${congLink(it)}.`, "", "pl");
        return ans(`${congLink(it)} ${congTag(it)} asistió al <b>${pct(a.pct_asistencia)}</b> de los pases de lista del Pleno ${it.c.camara === "S" ? "del Senado" : "de la Cámara de Diputados"}: ${fmt(a.presente)} presente, ${fmt(a.ausente)} ausente${a.ausente === 1 ? "" : "s"} y ${fmt(a.licencia)} con licencia, de ${fmt(a.pases)} pases.`,
          table(["Presente", "Ausente", "Licencia", "Pases", "% asist."], [[fmt(a.presente), fmt(a.ausente), fmt(a.licencia), fmt(a.pases), pct(a.pct_asistencia)]]), "pl");
      }
      const masAsiste = has(/(mas|mejor|mayor)\s+(asist|asiste)|asiste mas|asisten mas|nunca falta|no falta|menos falta/);
      const n = topN(qn, 5);
      const L = (R.pl?.miembros || []).filter(m => m.pases > 0 && (!cam || m.camara === cam))
        .sort((a, b) => masAsiste ? (b.pct_asistencia - a.pct_asistencia || a.ausente - b.ausente) : (a.pct_asistencia - b.pct_asistencia || b.ausente - a.ausente));
      const f = L[0];
      if (!f) return null;
      const fi = DATA.byName[f.camara + "|" + f.nombre];
      const avg = L.reduce((s, m) => s + m.pct_asistencia, 0) / L.length;
      return ans(`${masAsiste ? "Mayor" : "Menor"} asistencia al Pleno ${camTxt}: ${fi ? congLink(fi) : esc(nombreNat(f.nombre))} (${esc(f.sigla)}) con <b>${pct(f.pct_asistencia)}</b> (${fmt(f.ausente)} ausencias, ${fmt(f.licencia)} licencias de ${fmt(f.pases)} pases). Promedio: ${pct(avg.toFixed(1))}.`,
        table(["Congresista", "Cámara", "% asist.", "Ausente", "Licencia"], L.slice(0, n).map(m => { const it = DATA.byName[m.camara + "|" + m.nombre]; return [(it ? congLink(it) : esc(nombreNat(m.nombre))) + ` <span class="capb-tag">${esc(m.sigla)}</span>`, CAMC[m.camara], pct(m.pct_asistencia), fmt(m.ausente), fmt(m.licencia)]; })), "pl");
    }

    // 6) votaciones
    if (has(/\bvot|disciplin|contra su bancada|rebelde/)) {
      const per = findPerson(q);
      if (per) {
        if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
        const it = per.best, a = it.a;
        if (!a || !a.votaciones) return ans(`No hay votaciones del Pleno registradas para ${congLink(it)}.`, "", "pl");
        return ans(`En ${fmt(a.votaciones)} votaciones del Pleno, ${congLink(it)} ${congTag(it)} votó ${fmt(a.si)} a favor, ${fmt(a.no)} en contra y ${fmt(a.abst)} abstenciones (${fmt(a.no_voto)} sin voto). Votó con su bancada ${fmt(a.con_bancada)} veces y en contra ${fmt(a.contra_bancada)}.`,
          table(["Sí", "No", "Abst.", "Sin voto", "Con bancada", "Contra bancada"], [[fmt(a.si), fmt(a.no), fmt(a.abst), fmt(a.no_voto), fmt(a.con_bancada), fmt(a.contra_bancada)]]), "pl");
      }
      const n = topN(qn, 5);
      const L = (R.pl?.miembros || []).filter(m => m.votaciones > 0 && (!cam || m.camara === cam)).sort((a, b) => b.contra_bancada - a.contra_bancada || b.votaciones - a.votaciones);
      return ans(`Quienes más votaron contra la posición de su bancada ${camTxt}:`,
        table(["Congresista", "Cámara", "Contra bancada", "Con bancada"], L.slice(0, n).map(m => { const it = DATA.byName[m.camara + "|" + m.nombre]; return [(it ? congLink(it) : esc(nombreNat(m.nombre))) + ` <span class="capb-tag">${esc(m.sigla)}</span>`, CAMC[m.camara], fmt(m.contra_bancada), fmt(m.con_bancada)]; })), "pl");
    }

    // 7) bancadas
    if (has(/bancad|partido|grupo parlamentario|grupos parlamentarios/) && !findPerson(q)) {
      const L = [];
      ["D", "S"].forEach(c => { if (!cam || cam === c) (R.bi?.camaras?.[c]?.bancadas || []).forEach(b => L.push(Object.assign({ cam: c }, b))); });
      const porMiembro = has(/por miembro|promedio|per capita|productiv/);
      L.sort((a, b) => porMiembro ? b.por_miembro - a.por_miembro : b.proyectos - a.proyectos);
      const f = L[0];
      if (!f) return null;
      return ans(`${porMiembro ? "Con más proyectos por miembro" : "La bancada que más proyectos presenta"} ${camTxt}: <b>${esc(f.bancada)}</b> (${esc(CAMC[f.cam])}) con <b>${fmt(f.proyectos)}</b> proyectos de ${fmt(f.miembros)} miembros (${String(f.por_miembro).replace(".", ",")} por miembro).`,
        table(["Bancada", "Cámara", "Miembros", "Proyectos", "Por miembro"], L.slice(0, topN(qn, 10)).map(b => [esc(b.bancada), CAMC[b.cam], fmt(b.miembros), fmt(b.proyectos), String(b.por_miembro).replace(".", ",")])), "bi");
    }

    // 8) persona + proyectos  /  ranking de proyectos
    const per = findPerson(q);
    if (has(/proyect|present|ley|iniciativa|propuesta|firm/)) {
      if (per) {
        if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
        const it = per.best, c = it.c;
        const ps = (c.proyectos || []).slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
        const rank = DATA.cong.filter(x => x.c.camara === c.camara && x.c.principal > c.principal).length + 1;
        return ans(`${congLink(it)} ${congTag(it)} presentó <b>${fmt(c.principal)} proyectos</b> como autor principal y firmó ${fmt(c.firmas)} como coautor (puesto ${rank} de ${fmt(DATA.cong.filter(x => x.c.camara === c.camara).length)} en ${esc(CAMC[c.camara])}). Los más recientes:`,
          ps.length ? `<ul class="capb-ul">${ps.slice(0, 5).map(p => projRow(DATA.proyByCode[p.codigo])).join("")}</ul>` : "", "bi");
      }
      if (has(/mas|top|ranking|mayor|quien|menos|ninguno|cero/)) {
        const n = topN(qn, 5), menos = has(/\bmenos\b|ninguno|cero/);
        const L = DATA.cong.filter(x => !cam || x.c.camara === cam).sort((a, b) => menos ? a.c.principal - b.c.principal || a.c.firmas - b.c.firmas : b.c.principal - a.c.principal || b.c.firmas - a.c.firmas);
        const f = L[0];
        return ans(`${menos ? "Menos" : "Más"} proyectos como autor principal ${camTxt}: ${congLink(f)} ${congTag(f)} con <b>${fmt(f.c.principal)}</b>. Top ${n}:`,
          table(["Congresista", "Cámara", "Proyectos", "Firmas"], L.slice(0, n).map(x => [congLink(x) + " " + congTag(x), CAMC[x.c.camara], fmt(x.c.principal), fmt(x.c.firmas)])), "bi");
      }
      if (has(/cuant/)) {
        const b = R.bi, t = b.totales;
        return ans(`En el periodo ${esc(b.meta?.periodo)} se presentaron <b>${fmt(t.proyectos)} proyectos</b> y se publicaron ${fmt(t.leyes)} leyes.`,
          table(["Cámara", "Proyectos", "Leyes", "Archivados"], ["D", "S", "C"].filter(c => b.camaras[c]).map(c => [CAM[c], fmt(b.camaras[c].proyectos), fmt(b.camaras[c].leyes), fmt(b.camaras[c].archivados)])), "bi");
      }
    }

    // 9) solo un nombre → ficha resumida
    if (per && per.score >= 3) {
      if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
      return profile(per.best);
    }
    // 10) conteos generales
    if (has(/cuantos (congresistas|diputados|senadores)/)) {
      const L = DATA.cong.filter(x => !cam || x.c.camara === cam);
      return ans(`Hay <b>${fmt(L.length)}</b> ${cam === "S" ? "senadores" : cam === "D" ? "diputados" : "congresistas"} en el periodo ${esc(R.bi.meta?.periodo)}${cam ? "" : ` (${fmt(DATA.cong.filter(x => x.c.camara === "D").length)} diputados y ${fmt(DATA.cong.filter(x => x.c.camara === "S").length)} senadores)`}.`, "", "bi");
    }
    return null;
  }

  function stem(w) {
    for (const suf of ["ciones", "siones", "cion", "sion", "idades", "idad", "mente", "ias", "ia", "es", "os", "as", "s", "o", "a"]) {
      if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
    }
    return w;
  }
  function topicSearch(kw, cam) {
    const ks = words(kw).filter(t => t.length >= 3 && !Q_STOP.has(t)).map(stem);
    if (!ks.length) return null;
    const L = DATA.proy.filter(q => (!cam || q.p.camara === cam) && ks.every(k => q.ws.some(w => w.startsWith(k))))
      .sort((a, b) => (b.p.fecha || "").localeCompare(a.p.fecha || ""));
    if (!L.length) return ans(`No encontramos proyectos cuyo título mencione “${esc(kw)}”.`, "", "bi");
    const est = {};
    L.forEach(q => { const e = q.p.estado || "—"; est[e] = (est[e] || 0) + 1; });
    const estTxt = Object.entries(est).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, n]) => `${fmt(n)} ${esc(e.toLowerCase())}`).join(", ");
    return ans(`Hay <b>${fmt(L.length)} proyecto${L.length === 1 ? "" : "s"}</b> cuyo título menciona “${esc(kw)}”${cam ? " en " + esc(CAM[cam]) : ""} (${estTxt}). Los más recientes:`,
      `<ul class="capb-ul">${L.slice(0, 8).map(projRow).join("")}</ul>`, "bi");
  }
  function ambiguous(per, q) {
    return ans(`Hay ${fmt(per.all.length)} congresistas que coinciden con “${esc(q)}”. ¿A quién te refieres?`,
      `<ul class="capb-ul">${per.all.slice(0, 8).map(it => `<li><a class="capb-row" href="congresistas/${esc(it.slug)}.html"><b>${esc(nombreNat(it.c.nombre))}</b> ${congTag(it)}<br><span class="capb-mut">${esc(CAMC[it.c.camara])} · ${esc(it.c.distrito)}</span></a></li>`).join("")}</ul>`, "bi");
  }
  function profile(it) {
    const c = it.c, a = it.a, d = it.d;
    const rows = [["Cámara", esc(CAM[c.camara])], ["Bancada", esc(c.bancada)], ["Distrito electoral", esc(c.distrito)], ["Proyectos (autor)", fmt(c.principal)], ["Firmas (coautor)", fmt(c.firmas)]];
    if (a && a.pases) rows.push(["Asistencia al Pleno", `${pct(a.pct_asistencia)} (${fmt(a.ausente)} ausencias)`]);
    if (a && a.votaciones) rows.push(["Votos contra su bancada", `${fmt(a.contra_bancada)} de ${fmt(a.votaciones)}`]);
    if (d) rows.push(["Despacho", `${fmt(d.personal)} personas · ${soles(d.masa)}/mes`]);
    return ans(`${congLink(it)} ${congTag(it)} — ${esc(CAMC[c.camara] === "Senado" ? "senador(a)" : "diputado(a)")} por ${esc(c.distrito)}. <a class="capb-l" href="congresistas/${esc(it.slug)}.html">Ver ficha completa →</a>`,
      `<div class="capb-tw"><table class="capb-t">${rows.map(r => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join("")}</table></div>`, "bi", "pl", "mov");
  }

  /* ───────────── UI ───────────── */
  const EXAMPLES = [
    "¿Quién falta más al Pleno en el Senado?",
    "Top 5 diputados con más proyectos",
    "¿Qué bancada presenta más proyectos?",
    "Proveedores sancionados",
    "¿Cuánto contrató el Congreso con Entel?",
    "Proyectos sobre agua",
    "Proyectos sobre minería",
    "¿Cuánto gasta el despacho de Columbus?",
    "Despachos más caros del Senado",
    "¿Quién vota más contra su bancada?",
  ];
  const CSS = `
  .capb-fab{position:fixed;right:16px;bottom:16px;z-index:45;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border,#23262e);background:var(--accent,#e23744);color:#fff;font:600 14px/1 Inter,system-ui,sans-serif;padding:12px 16px;border-radius:999px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}
  .capb-fab:hover{filter:brightness(1.07)} .capb-fab kbd{font:600 11px/1 'Geist Mono',monospace;background:rgba(255,255,255,.2);border-radius:5px;padding:3px 6px}
  .capb-ov{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 16px}
  .capb-ov[hidden]{display:none}
  .capb-box{width:100%;max-width:720px;max-height:86vh;display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--text,#16181d);border:1px solid var(--border,#e6e8ec);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden;font-family:Inter,system-ui,sans-serif}
  .capb-hd{display:flex;gap:8px;align-items:center;padding:12px;border-bottom:1px solid var(--border,#e6e8ec)}
  .capb-in{flex:1;min-width:0;background:var(--panel-2,var(--panel));color:var(--text);border:1px solid var(--border);border-radius:10px;padding:11px 12px;font-size:16px;font-weight:500;line-height:1.2;font-family:inherit;outline:none}
  .capb-in:focus{border-color:var(--accent-2,#3b82f6)}
  .capb-x,.capb-go{flex:none;border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600;line-height:1;font-family:inherit;cursor:pointer}
  .capb-go{background:var(--accent-2,#3b82f6);border-color:var(--accent-2,#3b82f6);color:#fff}
  .capb-bd{overflow:auto;overflow-x:hidden;padding:12px 14px 16px;font-size:14px;line-height:1.45;overscroll-behavior:contain}
  .capb-bd h4{margin:14px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .capb-bd h4:first-child{margin-top:2px}
  .capb-ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
  .capb-row,.capb-pj,.capb-pv{display:block;width:100%;text-align:left;background:none;border:1px solid transparent;border-radius:9px;padding:7px 9px;color:var(--text);text-decoration:none;font:inherit;cursor:pointer;overflow-wrap:anywhere}
  .capb-row:hover,.capb-pj:hover,.capb-pv:hover,.capb-row:focus-visible,.capb-pj:focus-visible,.capb-pv:focus-visible{background:var(--panel-2,rgba(127,127,127,.08));border-color:var(--border)}
  div.capb-row{cursor:default}
  .capb-det{margin:4px 0 8px 9px;padding:10px 12px;border-left:3px solid var(--accent-2);background:var(--panel-2,transparent);border-radius:0 9px 9px 0;overflow-wrap:anywhere}
  .capb-mut{color:var(--muted);font-size:12.5px}
  .capb-code{font-family:'Geist Mono',monospace;font-size:12px;color:var(--accent-2)}
  .capb-tag{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:5px;border:1px solid var(--border);color:var(--muted);vertical-align:1px;white-space:nowrap}
  .capb-red{color:var(--accent,#e23744)!important;border-color:var(--accent,#e23744)}
  .capb-warn{color:var(--accent);font-weight:700;margin:8px 0 4px}
  .capb-l,.capb-lk{color:var(--accent-2);text-decoration:none;font-weight:600}
  .capb-lk{background:none;border:0;padding:0;font:inherit;font-weight:600;cursor:pointer;text-align:left}
  .capb-l:hover,.capb-lk:hover{text-decoration:underline}
  .capb-ans{border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px;background:var(--panel-2,transparent)}
  .capb-s{margin:0 0 8px}
  .capb-src{margin-top:8px;font-size:11.5px;color:var(--muted)}
  .capb-tw{max-width:100%;overflow-x:auto}
  .capb-t{width:100%;border-collapse:collapse;font-size:13px}
  .capb-t th,.capb-t td{padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;overflow-wrap:break-word}
  .capb-t thead th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700}
  .capb-t tbody th{color:var(--muted);font-weight:600;width:42%}
  .capb-t td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .capb-dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0 0 6px;font-size:13px}
  .capb-dl dt{color:var(--muted)} .capb-dl dd{margin:0;overflow-wrap:anywhere}
  .capb-ttl{margin:6px 0 0;font-size:13px}
  .capb-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}
  .capb-chip{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:999px;padding:6px 11px;font-size:12.5px;font-weight:500;line-height:1.2;font-family:inherit;cursor:pointer;text-align:left}
  .capb-chip:hover{border-color:var(--accent-2);color:var(--accent-2)}
  .capb-hint{font-size:12.5px;color:var(--muted);margin:0 0 6px}
  @media (max-width:520px){
    .capb-ov{padding:0}
    .capb-box{max-width:none;max-height:none;height:100%;border-radius:0;border:0}
    .capb-fab .capb-k{display:none}
    .capb-t{font-size:12.5px}
    .capb-t th,.capb-t td{padding:5px 6px}
  }`;

  let ov, box, inp, bd, lastFocus, timer;
  function lsGet() { try { return JSON.parse(localStorage.getItem("cap-bot-recientes") || "[]").filter(x => typeof x === "string").slice(0, 5); } catch (e) { return []; } }
  function lsPush(q) { try { const L = [q].concat(lsGet().filter(x => x !== q)).slice(0, 5); localStorage.setItem("cap-bot-recientes", JSON.stringify(L)); } catch (e) { /* sin almacenamiento */ } }

  function chips(list) { return `<div class="capb-chips">${list.map(t => `<button type="button" class="capb-chip" data-q="${esc(t)}">${esc(t)}</button>`).join("")}</div>`; }
  function home() {
    const rec = lsGet();
    let h = `<p class="capb-hint">Busca congresistas, proyectos, proveedores o comisiones, o haz una pregunta. Pulsa Enter para preguntar.</p><h4>Ejemplos</h4>${chips(EXAMPLES)}`;
    if (rec.length) h += `<h4>Recientes</h4>${chips(rec)}`;
    bd.innerHTML = h;
  }
  function build() {
    const st = document.createElement("style"); st.id = "capb-style"; st.textContent = CSS; document.head.appendChild(st);
    const fab = document.createElement("button");
    fab.type = "button"; fab.className = "capb-fab"; fab.id = "capb-fab";
    fab.setAttribute("aria-label", "Buscar o preguntar (atajo: /)");
    fab.innerHTML = `<span aria-hidden="true">🔎</span> Buscar / Preguntar <kbd class="capb-k">/</kbd>`;
    fab.addEventListener("click", open);
    document.body.appendChild(fab);
    ov = document.createElement("div"); ov.className = "capb-ov"; ov.hidden = true;
    ov.innerHTML = `<div class="capb-box" role="dialog" aria-modal="true" aria-label="Buscar o preguntar">
      <form class="capb-hd" autocomplete="off"><input class="capb-in" type="search" enterkeyhint="search" placeholder="Ej.: asistencia de Zunini, proyectos sobre agua…" aria-label="Buscar o preguntar">
      <button class="capb-go" type="submit">Preguntar</button><button class="capb-x" type="button" aria-label="Cerrar">✕</button></form>
      <div class="capb-bd" aria-live="polite"></div></div>`;
    document.body.appendChild(ov);
    box = ov.querySelector(".capb-box"); inp = ov.querySelector(".capb-in"); bd = ov.querySelector(".capb-bd");
    ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
    ov.querySelector(".capb-x").addEventListener("click", close);
    ov.querySelector("form").addEventListener("submit", e => { e.preventDefault(); ask(inp.value); });
    inp.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(live, 140); });
    bd.addEventListener("click", onBodyClick);
    box.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") { // trampa de foco
        const f = box.querySelectorAll("a[href],button:not([disabled]),input");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  function open(prefill) {
    lastFocus = document.activeElement;
    ov.hidden = false;
    document.documentElement.style.overflow = "hidden";
    if (typeof prefill === "string") inp.value = prefill;
    inp.focus(); inp.select();
    if (!DATA) bd.innerHTML = `<p class="capb-mut">Cargando datos…</p>`;
    load().then(() => { if (inp.value.trim()) live(); else home(); }).catch(() => { bd.innerHTML = `<p class="capb-mut">No se pudieron cargar los datos.</p>`; });
  }
  function close() {
    ov.hidden = true;
    document.documentElement.style.overflow = "";
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* noop */ }
  }
  function live() {
    if (!DATA) return;
    const q = inp.value.trim();
    if (!q) return home();
    const res = search(q);
    bd.innerHTML = `<p class="capb-hint">Pulsa <b>Enter</b> para preguntar al bot.</p>` + renderSearch(res, q);
  }
  function ask(q) {
    q = (q || "").trim();
    clearTimeout(timer);
    if (!q) return;
    inp.value = q;
    load().then(() => {
      clearTimeout(timer);
      let a = null;
      try { a = answer(q); } catch (e) { console.error("bot:", e); a = null; }
      lsPush(q);
      const r = a && search(q, 3), more = r && (r.cong.length + r.proy.length + r.prov.length + r.com.length);
      if (a) bd.innerHTML = a + (more ? `<h4>Resultados de búsqueda</h4>` + renderSearch(r, q) : "");
      else bd.innerHTML = `<div class="capb-ans"><p class="capb-s">No entendí la pregunta; estos son los resultados de búsqueda para “${esc(q)}”. Prueba con alguna de estas preguntas:</p>${chips(EXAMPLES.slice(0, 6))}</div>` + renderSearch(search(q), q);
      bd.scrollTop = 0;
    });
  }
  function onBodyClick(e) {
    const chip = e.target.closest(".capb-chip");
    if (chip) { ask(chip.getAttribute("data-q")); return; }
    const pj = e.target.closest(".capb-pj");
    if (pj) {
      const det = pj.nextElementSibling, q = DATA.proyByCode[pj.getAttribute("data-code")];
      if (det && q) { if (det.hidden) det.innerHTML = projDetail(q); det.hidden = !det.hidden; pj.setAttribute("aria-expanded", String(!det.hidden)); }
      return;
    }
    const pv = e.target.closest(".capb-pv");
    if (pv) {
      const det = pv.nextElementSibling, it = DATA.prov.find(p => p.ruc === pv.getAttribute("data-ruc"));
      if (det && it) { if (det.hidden) det.innerHTML = provDetail(it); det.hidden = !det.hidden; pv.setAttribute("aria-expanded", String(!det.hidden)); }
      return;
    }
    const po = e.target.closest(".capb-pv-open");
    if (po) {
      const it = DATA.prov.find(p => p.ruc === po.getAttribute("data-ruc"));
      if (it) bd.innerHTML = ans(`<b>${esc(it.nombre)}</b>: ${soles(it.monto)} en ${fmt(it.procesos)} procesos con el Congreso.`, provDetail(it), "con", "integ");
    }
  }
  function onKey(e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = (t && t.tagName) || "";
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;
    if (ov && !ov.hidden) return;
    e.preventDefault(); open();
  }

  function init() { build(); document.addEventListener("keydown", onKey); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  // API mínima para pruebas / otros scripts
  window.capBot = { open, close, ask, load, search: q => search(q), answerText: q => load().then(() => answer(q)) };
})();
