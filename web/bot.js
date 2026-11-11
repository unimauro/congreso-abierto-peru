/* Congreso Abierto Perú — Buscador global + asistente de preguntas (reglas, sin LLM, sin backend).
   Lee los JSON publicados en esta misma carpeta (carga diferida al abrir, en paralelo, tolera
   archivos ausentes). Autocontenido: inyecta su propio CSS y usa las variables de tema del sitio. */
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
  const millones = n => "S/ " + new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(n) + " M";
  const pct = n => (n == null || isNaN(n) ? "—" : String(Math.round(n * 10) / 10).replace(".", ",") + "%");
  const CAM = { D: "Cámara de Diputados", S: "Senado", C: "Congreso (bicameral)" };
  const CAMC = { D: "Diputados", S: "Senado", C: "Bicameral" };
  const fecha = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || ""); };
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
  const mesTxt = s => { const m = /^(\d{4})-(\d{2})/.exec(s || ""); return m ? `${MES[+m[2] - 1]} ${m[1]}` : (s || ""); };
  const nombreNat = n => { const p = String(n || "").split(","); return p.length > 1 ? (p[1].trim() + " " + p[0].trim()) : String(n || ""); };
  const apellidos = n => String(n || "").split(",")[0].trim();
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
  const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
  const titleCase = s => String(s || "").toLowerCase().replace(/(^|[\s(\-/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|El|Y|E|En|Para|Por|A|Al|Con)\b/g, w => w.toLowerCase());
  // Color por bancada (igual que web/build_seo.py; solo para distinguir, no son colores oficiales)
  const COLOR_BANCADA = { FP: "#f97316", JP: "#dc2626", RP: "#0ea5e9", AN: "#16a34a", PBG: "#7c3aed", PCO: "#0891b2", APP: "#2563eb", PP: "#db2777", SP: "#ca8a04" };

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
  function stem(w) {
    for (const suf of ["ciones", "siones", "cion", "sion", "idades", "idad", "mente", "ias", "ia", "es", "os", "as", "s", "o", "a"]) {
      if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
    }
    return w;
  }
  // ¿Todas (o casi todas) las palabras clave aparecen en la lista de palabras?
  function kwHits(ks, ws) {
    let h = 0;
    for (const k of ks) {
      if (/^\d+$/.test(k)) { const v = String(+k); if (ws.some(w => w === k || (/^\d+$/.test(w) && String(+w) === v))) h++; }
      else if (k.length >= 4 ? ws.some(w => w.startsWith(k)) : ws.includes(k)) h++;
    }
    return h;
  }

  /* ───────────── datos ───────────── */
  const FILES = { bi: "bicameral.json", pl: "plenos.json", mov: "movimientos.json", con: "contratos.json", integ: "integridad.json",
    pf: "perfiles.json", vis: "visitas.json", ase: "asesores.json", hist: "data.json", ctx: "context.json" };
  let DATA = null, loading = null;
  const getJSON = f => fetch(f, { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  function load() {
    if (DATA) return Promise.resolve(DATA);
    if (loading) return loading;
    const ks = Object.keys(FILES);
    loading = Promise.all(ks.map(k => getJSON(FILES[k]))).then(vals => {
      const R = {}; ks.forEach((k, i) => { R[k] = vals[i]; });
      DATA = index(R); return DATA;
    });
    return loading;
  }

  const orgName = s => { let n = String(s || "").replace(/\.\s*$/, "").replace(/Bicamenral/i, "Bicameral").replace(/^COMISIÓN DE BICAMERAL/i, "Comisión Bicameral"); if (n === n.toUpperCase()) n = titleCase(n); return n; };
  const CARGO_RANK = c => { const n = norm(c); return /^president/.test(n) ? 0 : /vicepresident/.test(n) ? 1 : /^secretari/.test(n) ? 2 : /titular|nato/.test(n) ? 3 : /suplente/.test(n) ? 4 : 5; };
  const ORG_STOP = new Set("comision comisiones de del en la las los y el e a bicameral bicamenral asuntos".split(" "));
  const orgKey = s => words(s).filter(w => !ORG_STOP.has(w)).join(" ");

  function index(R) {
    const D = { R, cong: [], proy: [], prov: [], com: [], org: [], vot: [], byName: {}, byNom: {}, bySlug: {} };
    const asis = {}, desp = {}, perf = {}, visi = {}, ases = {};
    (R.pl?.miembros || []).forEach(m => { asis[m.camara + "|" + m.nombre] = m; });
    (R.mov?.despachos || []).forEach(m => { desp[m.camara + "|" + m.nombre] = m; });
    (R.pf?.perfiles || []).forEach(m => { perf[m.camara + "|" + m.nombre] = m; });
    (R.vis?.congresistas || []).forEach(m => { visi[m.camara + "|" + m.nombre] = m; });
    // asesores: se omiten los nombres marcados como ambiguos (posibles homónimos)
    (R.ase?.asesores || []).filter(a => !a.ambiguo).forEach(a => { (ases[a.camara + "|" + a.despacho] = ases[a.camara + "|" + a.despacho] || []).push(a); });
    const nomIdx = {};
    ["D", "S"].forEach(cam => (R.pl?.camaras?.[cam]?.nominal_orden || []).forEach((n, i) => { nomIdx[cam + "|" + n] = i; }));
    (R.bi?.congresistas || []).forEach(c => {
      const k = c.camara + "|" + c.nombre;
      const it = { type: "cong", c, a: asis[k] || null, d: desp[k] || null, pf: perf[k] || null, vi: visi[k] || null, ase: ases[k] || [], slug: slug(c.nombre), ni: nomIdx[k] };
      it.ws = words(c.nombre + " " + c.distrito + " " + c.bancada + " " + (c.sigla || ""));
      it.nameWs = words(c.nombre).filter(w => w.length >= 3 && !NAME_STOP.has(w));
      it.hay = it.ws.join(" ");
      D.cong.push(it); D.byName[k] = it; D.byNom[c.nombre] = D.byNom[c.nombre] || it; D.bySlug[it.slug] = it;
    });
    // proyectos: lista completa (bicameral.json → proyectos[]) + respaldo con los de cada congresista y recientes
    const seen = {};
    const addProy = (p, autor) => {
      if (!p || !p.codigo || seen[p.codigo]) return;
      const coms = (p.com || []).map(i => R.bi?.camaras?.[p.camara]?.comisiones?.[i]?.nombre).filter(Boolean);
      const q = { type: "proy", p, autor: autor || (p.autor ? D.byNom[p.autor] || null : null), coms };
      q.ws = words(p.codigo + " " + p.titulo); q.hay = q.ws.join(" ");
      seen[p.codigo] = q; D.proy.push(q);
    };
    (R.bi?.proyectos || []).forEach(p => addProy(p));
    D.cong.forEach(it => (it.c.proyectos || []).forEach(p => addProy(Object.assign({ camara: it.c.camara }, p), it)));
    (R.bi?.recientes || []).forEach(p => addProy(p));
    D.proyByCode = seen;
    D.proyByAutor = {};
    D.proy.forEach(q => { if (q.autor) (D.proyByAutor[q.autor.c.nombre] = D.proyByAutor[q.autor.c.nombre] || []).push(q); });
    Object.values(D.proyByAutor).forEach(L => L.sort((a, b) => (b.p.fecha || "").localeCompare(a.p.fecha || "") || b.p.codigo.localeCompare(a.p.codigo)));
    // votaciones del Pleno
    ["D", "S"].forEach(cam => (R.pl?.camaras?.[cam]?.votaciones || []).forEach(v => {
      D.vot.push({ cam, v, ws: words(v.asunto || "") });
    }));
    D.vot.sort((a, b) => (b.v.fecha || "").localeCompare(a.v.fecha || "") || (b.v.id || "").localeCompare(a.v.id || ""));
    D.votById = {}; D.vot.forEach(x => { D.votById[x.v.id] = x; });
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
    // comisiones (órganos) con sus integrantes, desde perfiles.json; las bicamerales se agrupan aparte
    const orgs = {};
    (R.pf?.perfiles || []).forEach(p => {
      const it = D.byName[p.camara + "|" + p.nombre];
      if (!it) return;
      (p.comisiones || []).forEach(cm => {
        if (cm.tipo === "Grupo parlamentario") return;
        const cam = cm.tipo === "Bicameral" ? "C" : p.camara;
        const key = cam + "|" + orgKey(cm.organo);
        const o = orgs[key] || (orgs[key] = { cam, key, tipo: cm.tipo, nombres: {}, miembros: [] });
        o.nombres[cm.organo] = (o.nombres[cm.organo] || 0) + 1;
        o.miembros.push({ it, cargo: cm.cargo || "", desde: cm.desde });
      });
    });
    Object.values(orgs).forEach(o => {
      // nombre visible: la variante más frecuente que no esté en mayúsculas sostenidas
      const vs = Object.entries(o.nombres).sort((a, b) => (a[0] === a[0].toUpperCase()) - (b[0] === b[0].toUpperCase()) || b[1] - a[1]);
      let n = orgName(vs[0][0]);
      if (n.length > 110) n = trunc(n, 110);
      o.nombre = n;
      o.miembros.sort((a, b) => CARGO_RANK(a.cargo) - CARGO_RANK(b.cargo) || a.it.c.nombre.localeCompare(b.it.c.nombre));
      o.ws = words(n);
      o.kws = orgKey(n).split(" ").filter(Boolean);
      // proyectos derivados (bicameral.json → camaras[cam].comisiones)
      const bc = (R.bi?.camaras?.[o.cam]?.comisiones || []).map(x => ({ x, s: kwHits(orgKey(x.nombre).split(" ").map(stem), o.kws) / Math.max(1, orgKey(x.nombre).split(" ").length) }))
        .sort((a, b) => b.s - a.s)[0];
      o.bic = bc && bc.s >= 0.7 ? bc.x : null;
      D.org.push(o);
      const s = { type: "com", o, cam: o.cam, nombre: o.nombre, proyectos: o.bic ? o.bic.proyectos : null, miembros: o.miembros.length };
      s.ws = words(o.nombre + " comision"); s.hay = s.ws.join(" ");
      D.com.push(s);
    });
    // bancadas (para filtros "proyectos de Fuerza Popular…")
    const bs = {};
    D.cong.forEach(it => { bs[it.c.bancada] = it.c.sigla; });
    D.banc = Object.entries(bs).map(([b, s]) => ({ bancada: b, sigla: s, kws: words(b).filter(w => !["partido", "del", "el", "por", "de", "la"].includes(w)) }));
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
    out.sort((a, b) => b.s - a.s || (b.it.c?.principal || b.it.monto || b.it.miembros || 0) - (a.it.c?.principal || a.it.monto || a.it.miembros || 0));
    return out.slice(0, n).map(x => x.it);
  }
  function search(q, n = 5) {
    const toks = words(q).filter(t => !Q_STOP.has(t));
    if (!toks.length || !DATA) return null;
    return { cong: searchList(DATA.cong, toks, n), proy: searchList(DATA.proy, toks, n), prov: searchList(DATA.prov, toks, n), com: searchList(DATA.com, toks, n) };
  }

  /* ───────────── entidades dentro de una pregunta ───────────── */
  const INTENT_WORDS = new Set(("proyecto proyectos presento presentado presentados presenta presentan ley leyes asistencia asiste asistio falta faltas falto ausencia ausencias " +
    "pleno gasta gasto gastos despacho despachos planilla personal asesor asesores asesora trabajadores sueldo sueldos cuesta costo vota voto votos votacion votaciones votaron votado " +
    "diputado diputada diputados senador senadora senadores senado camara congreso congresista congresistas bancada bancadas partido mas menos top ranking " +
    "quien cuanto cuantos contrato contrataron contratos proveedor proveedores sancionado sancionados sobre tiene tienen hay dime info informacion datos ficha " +
    "perfil buscar busca muestra muestrame ver lista mayor menor primero primeros contra firma firmas autor autoria caro caros cara costoso costosos " +
    "promedio vigente vigentes mejor peor nunca siempre veces cuantas ultimo ultima ultimos ultimas recientes reciente comision comisiones preside presiden presidente presidenta " +
    "miembros integrantes integra esta estan forma visita visitas visitan visito visitaron recibe reciben instituciones entidades representacion semana viaje viajes viajo " +
    "resumen compara comparar comparacion versus trayectoria equipo trabajaron trabajo riesgo fiscal favor abstuvo abstencion dijo tema").split(" "));

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
  // tokens de la consulta que corresponden al nombre de una persona (para quitarlos del "tema")
  function nameToks(qn, it) {
    return new Set(words(qn).filter(t => it.nameWs.some(w => w === t || (t.length >= 4 && w.startsWith(t)) || (t.length >= 6 && lev(t, w, 1) <= 1))));
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
    if (/\bdiputad(o|a|os|as)\b|\bcamara baja\b/.test(qn)) return "D";
    return null;
  }
  function topN(qn, def = 5) {
    const m = /\b(?:top|primeros|primeras|los|las|ultimos|ultimas)\s+(\d{1,2})\b/.exec(qn) || /\b(\d{1,2})\s+(?:diputad|senador|congresist|bancad|proveedor|despacho|entidad|institucion|proyecto|asesor|votacion)/.exec(qn);
    const n = m ? +m[1] : def;
    return Math.max(1, Math.min(30, n));
  }
  function findBancada(qn) {
    if (!DATA) return null;
    const ws = words(qn);
    for (const b of DATA.banc) if (b.kws.length && b.kws.every(k => ws.includes(k))) return b;
    for (const b of DATA.banc) if (b.sigla && b.sigla.length >= 2 && b.sigla !== "AN" && ws.includes(b.sigla.toLowerCase())) return b;
    return null;
  }
  const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  // fecha dentro de la pregunta → { test(fechaISO), txt, used:Set(tokens) }
  function parseFecha(q) {
    const qn = norm(q), used = new Set();
    let y = null, m = null, d = null, r;
    if ((r = /(\d{4})-(\d{2})-(\d{2})/.exec(q))) { y = +r[1]; m = +r[2]; d = +r[3]; used.add(r[1]); used.add(r[2]); used.add(r[3]); }
    else if ((r = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(q))) { d = +r[1]; m = +r[2]; if (r[3]) y = +(r[3].length === 2 ? "20" + r[3] : r[3]); }
    else if ((r = new RegExp("\\b(\\d{1,2}) de (" + Object.keys(MESES).join("|") + ")(?: (?:de |del )?(\\d{4}))?\\b").exec(qn))) { d = +r[1]; m = MESES[r[2]]; if (r[3]) y = +r[3]; used.add(r[1]); used.add(r[2]); if (r[3]) used.add(r[3]); }
    else if ((r = new RegExp("\\b(" + Object.keys(MESES).join("|") + ")(?: (?:de |del )?(\\d{4}))?\\b").exec(qn))) { m = MESES[r[1]]; if (r[2]) y = +r[2]; used.add(r[1]); if (r[2]) used.add(r[2]); }
    if (!m || m > 12 || (d && d > 31)) return null;
    const p2 = n => String(n).padStart(2, "0");
    const txt = (d ? d + " de " : "") + Object.keys(MESES).find(k => MESES[k] === m) + (y ? " de " + y : "");
    return { used, txt, test: f => { const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ""); return !!x && +x[2] === m && (!d || +x[3] === d) && (!y || +x[1] === y); }, iso: (y ? y + "-" : "") + p2(m) + (d ? "-" + p2(d) : "") };
  }

  /* ───────────── componentes de renderizado ───────────── */
  const congHref = it => `congresistas/${esc(it.slug)}.html`;
  const explHref = it => `index.html#bicameral?cam=${esc(it.c.camara)}&amp;c=${esc(it.slug)}`;
  const congLink = it => `<a class="capb-l" href="${congHref(it)}">${esc(nombreNat(it.c.nombre))}</a>`;
  const bchip = (sigla, bancada) => { const col = COLOR_BANCADA[sigla] || ""; return `<span class="capb-bc"${col ? ` style="--bc:${col}"` : ""}${bancada ? ` title="${esc(bancada)}"` : ""}>${esc(sigla || bancada || "—")}</span>`; };
  const congTag = it => bchip(it.c.sigla, it.c.bancada);
  const initials = n => { const nn = nombreNat(n).split(/\s+/).filter(Boolean); const ap = apellidos(n).split(/\s+/)[0] || ""; return esc(((nn[0] || "")[0] || "") + (ap[0] || "")).toUpperCase(); };
  function avatar(it, size) {
    const foto = safeUrl(it && it.pf && it.pf.foto);
    const ini = it ? initials(it.c.nombre) : "CA";
    const col = it ? COLOR_BANCADA[it.c.sigla] || "" : "";
    const st = `${size ? `width:${size}px;height:${size}px;` : ""}${col ? `--bc:${col};` : ""}`;
    return foto ? `<span class="capb-av" style="${st}"><img class="capb-img" src="${esc(foto)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ini="${ini}"></span>`
      : `<span class="capb-av capb-av-i" style="${st}" aria-hidden="true">${ini}</span>`;
  }
  const bar = (v, max, cls) => `<span class="capb-bar${cls ? " " + cls : ""}" aria-hidden="true"><i style="width:${max > 0 ? Math.max(1.5, Math.min(100, (v / max) * 100)).toFixed(1) : 0}%"></i></span>`;
  const tile = (val, lab, sub, cls) => `<div class="capb-tile${cls ? " " + cls : ""}"><b>${val}</b><span>${lab}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = arr => `<div class="capb-tiles">${arr.join("")}</div>`;
  const table = (head, rows) => `<div class="capb-tw"><table class="capb-t"><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i && /^[\d.,%S/ \-—]+$/.test(String(c).replace(/<[^>]+>/g, "")) ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const h5 = t => `<h5 class="capb-h">${t}</h5>`;
  const VOTO = { S: ["Sí", "si"], N: ["No", "no"], A: ["Abstención", "ab"], X: ["Ausente", "au"], L: ["Licencia", "li"], R: ["Sin respuesta", "ot"], P: ["Presente (sin voto)", "ot"], "-": ["Sin dato", "ot"] };
  const POS = { si: ["Sí", "si"], no: ["No", "no"], abst: ["Abstención", "ab"] };
  const vchip = ch => { const v = VOTO[ch] || VOTO["-"]; return `<span class="capb-v capb-v-${v[1]}">${v[0]}</span>`; };
  const pchip = p => { const v = POS[p]; return v ? `<span class="capb-v capb-v-${v[1]}">${v[0]}</span>` : `<span class="capb-v capb-v-ot">${esc(p || "—")}</span>`; };
  function stack(v) {
    const si = v.si || 0, no = v.no || 0, ab = v.abst || 0;
    const tot = si + no + ab || 1;
    return `<div class="capb-stack" role="img" aria-label="${fmt(si)} a favor, ${fmt(no)} en contra, ${fmt(ab)} abstenciones"><i class="si" style="flex:${si}"></i><i class="no" style="flex:${no}"></i><i class="ab" style="flex:${ab}"></i></div>` +
      `<div class="capb-leg"><span><i class="si"></i>Sí ${fmt(si)}</span><span><i class="no"></i>No ${fmt(no)}</span><span><i class="ab"></i>Abst. ${fmt(ab)}</span><span class="capb-mut">${pct(si / tot * 100)} a favor</span></div>`;
  }
  // lista de ranking con barras
  function rankList(rows, f, max) {
    max = max == null ? Math.max(...rows.map(r => r.v), 0) : max;
    return `<ol class="capb-rank">${rows.map((r, i) => `<li${r.it ? "" : ' class="na"'}><span class="capb-rk">${r.rank || i + 1}</span>${r.it ? avatar(r.it, 28) : ""}` +
      `<div class="capb-rn">${r.it ? congLink(r.it) + " " + congTag(r.it) : r.label}${r.sub ? `<small>${r.sub}</small>` : r.it ? `<small>${esc(CAMC[r.it.c.camara])} · ${esc(r.it.c.distrito)}</small>` : ""}${bar(r.v, max)}</div>` +
      `<b class="capb-rv">${f(r.v)}</b></li>`).join("")}</ol>`;
  }
  // columnas (serie) en CSS puro
  function cols(serie, f, hi) {
    const max = Math.max(...serie.map(s => s.v), 0);
    return `<div class="capb-cols" role="img" aria-label="${esc(serie.map(s => s.k + ": " + f(s.v)).join("; "))}">${serie.map(s => `<div class="capb-col${s.k === hi ? " on" : ""}" title="${esc(s.k + ": " + f(s.v))}"><i style="height:${max ? Math.max(3, s.v / max * 100).toFixed(1) : 0}%"></i><span>${esc(s.lab || s.k)}</span></div>`).join("")}</div>`;
  }
  const projRow = q => `<li><button type="button" class="capb-pj" data-code="${esc(q.p.codigo)}" aria-expanded="false"><span class="capb-code">${esc(q.p.codigo)}</span> <span class="capb-mut">${esc(fecha(q.p.fecha))}${q.autor ? " · " + esc(nombreNat(q.autor.c.nombre)) : q.p.proponente ? " · " + esc(q.p.proponente) : ""}</span>${q.p.riesgo_fiscal ? ' <span class="capb-tag capb-amb">riesgo fiscal</span>' : ""}<br>${esc(trunc(q.p.titulo, 150))}</button><div class="capb-det" hidden></div></li>`;
  function projDetail(q) {
    const p = q.p;
    return `<dl class="capb-dl"><dt>Código</dt><dd>${esc(p.codigo)}</dd><dt>Cámara</dt><dd>${esc(CAM[p.camara] || p.camara || "—")}</dd>` +
      `<dt>Fecha</dt><dd>${esc(fecha(p.fecha))}</dd><dt>Estado</dt><dd>${esc(p.estado || "—")}</dd><dt>Eje</dt><dd>${esc(p.agenda || "—")}</dd>` +
      (q.coms && q.coms.length ? `<dt>Comisión</dt><dd>${q.coms.map(esc).join("; ")}</dd>` : "") +
      (p.riesgo_fiscal ? `<dt>Riesgo fiscal</dt><dd>Sí (inferido por palabras clave del título)</dd>` : "") +
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
  function src(keys) {
    const R = DATA.R, parts = [];
    let corte = "";
    const c = s => { const m = /^\d{4}-\d{2}-\d{2}/.exec(s || ""); if (m && m[0] > corte) corte = m[0]; return m ? fecha(m[0]) : ""; };
    (keys || []).forEach(k => {
      if (k === "bi" && R.bi) parts.push(`Proyectos: API del Congreso (spley) · corte ${c(R.bi.meta?.generado)}`);
      if (k === "pl" && R.pl) parts.push(`Pleno: reportes de asistencia y votación (PDF) · corte ${c(R.pl.meta?.generado)}`);
      if (k === "mov" && R.mov) parts.push(`Despachos: planilla nominal PTE (${esc(mesTxt((R.mov.meta?.meses || []).slice(-1)[0]))}) · corte ${c(R.mov.meta?.generado)}`);
      if (k === "con" && R.con) parts.push(`Contratos: OECE/SEACE (OCDS) desde ${esc(mesTxt(R.con.meta?.desde))} · corte ${c(R.con.meta?.generado)}`);
      if (k === "integ" && R.integ) parts.push(`Sanciones: OECE datos abiertos · corte ${c(R.integ.meta?.generado)}`);
      if (k === "pf" && R.pf) parts.push(`Perfiles y comisiones: webs oficiales de Diputados y Senado · corte ${c(R.pf.meta?.generado)}`);
      if (k === "vis" && R.vis) parts.push(`Visitas: registro de visitas del Congreso desde ${esc(fecha(R.vis.meta?.desde))} · corte ${c(R.vis.meta?.generado)}`);
      if (k === "ase" && R.ase) parts.push(`Trayectoria: cruce por nombre (sin DNI) con planillas PTE, DJ de intereses, El Peruano y OCDS; pueden existir homónimos · corte ${c(R.ase.meta?.generado)}`);
      if (k === "hist" && R.hist) parts.push(`Periodo 2021–2026: API del Congreso (spley) · corte ${c(R.hist.meta?.generado)}`);
      if (k === "ctx" && R.ctx) parts.push(`Presupuesto: MEF – Consulta Amigable (SIAF), pliego 028 Congreso de la República`);
    });
    if (!parts.length) parts.push("Congreso Abierto Perú (datos públicos oficiales)");
    // si todas las fuentes comparten la fecha de corte, se muestra una sola vez
    if (corte) { const tag = " · corte " + fecha(corte); if (parts.every(p => p.endsWith(tag) || !/ · corte /.test(p))) parts.forEach((p, i) => { parts[i] = p.endsWith(tag) ? p.slice(0, -tag.length) : p; }); }
    return `<div class="capb-src">${corte ? `<b>Datos al ${fecha(corte)}</b> · ` : ""}Fuente: ${parts.join(" · ")}</div>`;
  }
  // respuesta estructurada
  const A = (text, body, srcKeys, follow, who) => ({ text, body: body || "", src: srcKeys || [], follow: follow || [], who: who || null });
  const fu = it => apellidos(it.c.nombre); // nombre corto para preguntas de seguimiento
  const nada = (text, keys) => A(text, "", keys);

  /* ───────────── intenciones ───────────── */
  function answer(q) {
    const R = DATA.R, qn = norm(q);
    const has = re => re.test(qn);
    const cam = camaraDe(qn);
    const camTxt = cam ? (cam === "S" ? "en el Senado" : "en la Cámara de Diputados") : "en ambas cámaras";
    const n = topN(qn, 5);
    const asc = has(/\b(menos|menor|menores|peor|minimo|mas bajo|mas baja|mas barato|mas baratos|mas baratas)\b/);

    // 0) votación por id (seguimiento)
    const vid = /\b([ds])-(\d{8})-(\d{4})\b/i.exec(q);
    if (vid) { const x = DATA.votById[vid[0].toUpperCase()]; if (x) return voteCard(x, qn, null); }
    // 0b) ayuda
    if (/^(hola|buenas|ayuda|help|que (puedes|sabes) hacer|que puedo preguntar|como funciona)\b/.test(qn)) return helpCard();

    // 1) comparar congresistas
    if (has(/\bcompar|\bvs\b|\bversus\b|\bfrente a\b|diferencia(s)? entre/)) { const r = compare(q, qn); if (r) return r; }

    // 2) presupuesto / costo del Congreso / planilla total / trabajadores
    const per0 = findPerson(q);
    if (!per0 && !has(/comision/) && has(/presupuesto|cuanto (cuesta|costo|costaba|gasta|gasto) (el |al )?congreso|cuesta el congreso|costo del congreso|gasta el congreso|gasto del congreso|\bpia\b|\bpim\b|devengado/)) return presupuesto(qn);
    if (!per0 && has(/planilla total|total de (la )?planilla|planilla del congreso|cuantos trabajadores|cuantas personas trabajan|trabajadores (tiene )?(del|el) congreso|cuantos empleados|cuantos trabajan|masa salarial/)) return planillaTotal();

    // 3) periodo 2021–2026 (data.json)
    if (has(/\b2021\b|periodo anterior|congreso anterior|anterior congreso|congreso pasado|unicameral|2021 2026/) && R.hist) return historico(qn, n);

    // 4) votaciones sobre un tema / nominales
    if (has(/\bvot|abstuv|abstencion|en contra de|a favor de/)) { const r = votos(q, qn, cam, n); if (r) return r; }

    // 5) proyectos con filtros (riesgo fiscal, bancada, comisión, tema, último de X)
    if (has(/proyect|iniciativ|propuesta|\bleyes\b|proposicion/)) { const r = proyectos(q, qn, cam, n, asc); if (r) return r; }

    // 6) comisiones
    if (has(/comision|\bpreside|presidente|presidenta|mesa directiva|junta de portavoces/)) { const r = comisiones(q, qn, cam); if (r) return r; }

    // 7) visitas
    if (has(/visit/)) { const r = visitas(q, qn, cam, n, asc); if (r) return r; }

    // 8) asesores y trayectoria
    if (has(/asesor|trayectoria|trabajaron en|trabajo en|vienen de|provienen de|pasaron por|equipo de/)) { const r = asesores(q, qn, cam, n); if (r) return r; }

    // 9) semana de representación / viajes
    if (has(/representacion|semana de rep|viaj/)) { const r = representacion(q, qn, cam, n); if (r) return r; }

    // 10) sanciones
    if (has(/sancion|inhabilit|multad|penalidad/)) {
      const pv = findProveedor(q);
      if (pv) return A(pv.s ? `<b>${esc(pv.nombre)}</b> ${pv.s.vigente ? "tiene una sanción <b>vigente</b>" : "registra sanciones (no vigentes)"} en OECE y contrató ${soles(pv.monto)} con el Congreso.` : `<b>${esc(pv.nombre)}</b> no registra sanciones en OECE.`, provDetail(pv), ["con", "integ"], ["Proveedores sancionados", "Top 10 proveedores del Congreso"]);
      const t = R.integ?.totales || {};
      let L = (R.integ?.proveedores || []).filter(p => p.sanciones?.length);
      const soloVig = has(/vigente/);
      if (soloVig) L = L.filter(p => p.vigente);
      L.sort((a, b) => (b.vigente - a.vigente) || (b.monto_congreso || 0) - (a.monto_congreso || 0));
      const k = topN(qn, 10);
      return A(`De ${fmt(t.proveedores_revisados)} proveedores del Congreso revisados, <b>${fmt(t.con_sancion)}</b> tienen sanciones en OECE y <b>${fmt(t.vigentes)}</b> están vigentes. ${soloVig ? "Vigentes" : "Los " + Math.min(k, L.length) + " con más monto contratado"}:`,
        tiles([tile(fmt(t.proveedores_revisados), "revisados"), tile(fmt(t.con_sancion), "con sanción", "", "amb"), tile(fmt(t.vigentes), "vigentes", "", "red")]) +
        table(["Proveedor", "Vigente", "Sanciones", "Monto Congreso"], L.slice(0, k).map(p => [`<button type="button" class="capb-lk capb-pv-open" data-ruc="${esc(p.ruc)}">${esc(p.nombre)}</button>`, p.vigente ? '<span class="capb-red">Sí</span>' : "No", fmt(p.sanciones.length), soles(p.monto_congreso)])),
        ["integ", "con"], ["Proveedores con sanción vigente", "Top 10 proveedores del Congreso"]);
    }

    // 11) contratos / proveedores
    if (has(/\bcontrat|proveedor|\bruc\b|\bpag[oa]|\bcompr[oa]|seace|licitacion|adjudic/)) {
      const pv = findProveedor(q);
      if (pv) return A(`El Congreso contrató <b>${soles(pv.monto)}</b> con <b>${esc(pv.nombre)}</b> en ${fmt(pv.procesos)} proceso${pv.procesos === 1 ? "" : "s"} (desde ${esc(mesTxt(R.con?.meta?.desde))}).`, provDetail(pv), ["con", "integ"], ["Top 10 proveedores del Congreso", "Proveedores sancionados"]);
      const t = R.con?.totales || {};
      if (has(/proveedor|mas|top|quien|ranking|mayor|cuanto|total/) && R.con) {
        const k = topN(qn, 5), L = (R.con.proveedores || []).slice().sort((a, b) => b.monto - a.monto).slice(0, k);
        const anios = Object.entries(R.con.por_anio || {}).map(([y, o]) => ({ k: y, v: o.monto, lab: "’" + y.slice(2) }));
        return A(`El Congreso adjudicó <b>${soles(t.monto)}</b> en ${fmt(t.procesos)} procesos a ${fmt(t.proveedores)} proveedores desde ${esc(mesTxt(R.con.meta?.desde))}; los 10 mayores concentran el ${pct(t.top10_pct)}. Top ${k}:`,
          tiles([tile(soles(t.monto), "adjudicado"), tile(fmt(t.procesos), "procesos"), tile(fmt(t.proveedores), "proveedores"), tile(fmt(t.postor_unico), "con postor único", "", "amb")]) +
          h5("Monto por año") + cols(anios, soles) + h5(`Top ${k} proveedores`) +
          rankList(L.map(p => ({ label: `<button type="button" class="capb-lk capb-pv-open" data-ruc="${esc(p.ruc)}">${esc(p.nombre)}</button>`, sub: `${fmt(p.procesos)} procesos · ${pct(p.pct)} del total`, v: p.monto })), soles),
          ["con"], ["Proveedores sancionados", "¿Cuánto contrató el Congreso con Entel?", "Presupuesto del Congreso 2026"]);
      }
    }

    // 12) ranking genérico ("top", "ranking", "más/menos …") sin persona
    const per = per0;
    const met = metricOf(qn);
    if (!per && met && (!has(/bancad|partido/) || met.key === "contra") && has(/\b(ranking|top|mas|menos|mayor|menor|mayores|menores|peor|mejor|quien|quienes|primeros|lider|lideran|nunca|caros?|baratos?)\b/)) return ranking(met, cam, n, met.dir ? met.dir === "asc" : asc, qn);
    if (has(/^(ranking|rankings|top|tops)$/)) return rankMenu();

    // 13) despacho / gasto en personal de un congresista
    if (per && has(/gast|despacho|planilla|trabajador|sueldo|cuesta|costo|personal|equipo/)) {
      if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
      return despacho(per.best);
    }
    // 14) asistencia de un congresista
    if (per && has(/asist|falt|ausen|inasist|falton|licencia|\bva al pleno/)) {
      if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
      const it = per.best, a = it.a;
      if (!a || !a.pases) return nada(`No hay pases de lista del Pleno registrados para ${congLink(it)}.`, ["pl"]);
      const L = (R.pl?.miembros || []).filter(m => m.camara === it.c.camara && m.pases > 0);
      const avg = L.reduce((s, m) => s + m.pct_asistencia, 0) / (L.length || 1);
      const rank = L.filter(m => m.pct_asistencia > a.pct_asistencia).length + 1;
      return A(`${congLink(it)} ${congTag(it)} asistió al <b>${pct(a.pct_asistencia)}</b> de los pases de lista del Pleno ${it.c.camara === "S" ? "del Senado" : "de la Cámara de Diputados"}: ${fmt(a.presente)} presente, ${fmt(a.ausente)} ausente${a.ausente === 1 ? "" : "s"} y ${fmt(a.licencia)} con licencia, de ${fmt(a.pases)} pases.`,
        tiles([tile(pct(a.pct_asistencia), "asistencia", `promedio de la cámara: ${pct(avg)}`), tile(fmt(a.ausente), "ausencias", "", a.ausente ? "red" : ""), tile(fmt(a.licencia), "licencias"), tile(`${rank}°`, "puesto", `de ${fmt(L.length)} en ${esc(CAMC[it.c.camara])}`)]) +
        `<div class="capb-cmp"><span>${esc(apellidos(it.c.nombre))}</span>${bar(a.pct_asistencia, 100)}<b>${pct(a.pct_asistencia)}</b><span>Promedio</span>${bar(avg, 100, "mut")}<b>${pct(avg)}</b></div>`,
        ["pl"], [`¿Cómo votó ${fu(it)}?`, `Resumen de ${fu(it)}`, `¿Quién falta más al Pleno ${it.c.camara === "S" ? "en el Senado" : "en Diputados"}?`], it);
    }
    // 15) bancadas
    if (has(/bancad|partido|grupo parlamentario|grupos parlamentarios/) && !per) {
      const L = [];
      ["D", "S"].forEach(c => { if (!cam || cam === c) (R.bi?.camaras?.[c]?.bancadas || []).forEach(b => L.push(Object.assign({ cam: c }, b))); });
      const porMiembro = has(/por miembro|promedio|per capita|productiv/);
      if (porMiembro) for (let i = L.length - 1; i >= 0; i--) if (L[i].por_miembro == null) L.splice(i, 1);
      L.sort((a, b) => porMiembro ? b.por_miembro - a.por_miembro : b.proyectos - a.proyectos);
      const f = L[0];
      if (!f) return null;
      const sig = b => (DATA.banc.find(x => x.bancada === b) || {}).sigla;
      return A(`${porMiembro ? "Con más proyectos por miembro" : "La bancada que más proyectos presenta"} ${camTxt}: ${bchip(sig(f.bancada), f.bancada)} <b>${esc(f.bancada)}</b> (${esc(CAMC[f.cam])}) con <b>${fmt(f.proyectos)}</b> proyectos de ${fmt(f.miembros)} miembros (${String(f.por_miembro).replace(".", ",")} por miembro).`,
        rankList(L.slice(0, topN(qn, 12)).map(b => ({ label: `${bchip(sig(b.bancada), b.bancada)} ${esc(b.bancada)}`, sub: `${esc(CAMC[b.cam])} · ${fmt(b.miembros)} miembros · ${porMiembro ? fmt(b.proyectos) + " proyectos" : b.por_miembro == null ? "sin miembros en el padrón" : String(b.por_miembro).replace(".", ",") + " por miembro"}`, v: porMiembro ? b.por_miembro : b.proyectos })), porMiembro ? (v => String(v).replace(".", ",")) : fmt),
        ["bi"], [porMiembro ? "¿Qué bancada presenta más proyectos?" : "Bancadas con más proyectos por miembro", "Proyectos de Fuerza Popular sobre salud", "¿Quién vota más contra su bancada?"]);
    }
    // 16) votaciones de un congresista (resumen)
    if (per && has(/\bvot|disciplin|contra su bancada|rebelde/)) {
      if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
      return votoResumen(per.best);
    }
    // 17) proyectos de un congresista / conteo general
    if (has(/proyect|present|ley|iniciativa|propuesta|firm/)) {
      if (per) {
        if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
        return proyPersona(per.best, false);
      }
      if (has(/cuant/)) {
        const b = R.bi, t = b.totales;
        return A(`En el periodo ${esc(b.meta?.periodo)} se presentaron <b>${fmt(t.proyectos)} proyectos</b> y se publicaron ${fmt(t.leyes)} leyes.`,
          table(["Cámara", "Proyectos", "Leyes", "Archivados"], ["D", "S", "C"].filter(c => b.camaras[c]).map(c => [CAM[c], fmt(b.camaras[c].proyectos), fmt(b.camaras[c].leyes), fmt(b.camaras[c].archivados)])) +
          h5("Proyectos por mes (Diputados + Senado)") + cols(Object.keys(Object.assign({}, b.camaras.D?.por_mes, b.camaras.S?.por_mes)).sort().map(m => ({ k: m, lab: mesTxt(m).split(" ")[0], v: (b.camaras.D?.por_mes?.[m] || 0) + (b.camaras.S?.por_mes?.[m] || 0) })), fmt),
          ["bi"], ["Proyectos con riesgo fiscal", "Top 5 diputados con más proyectos", "¿Qué bancada presenta más proyectos?"]);
      }
    }
    // 18) comisiones / representación / visitas sin persona ya se trataron; solo un nombre → ficha
    if (per && per.score >= 3) {
      if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
      return profile(per.best);
    }
    // 19) conteos generales
    if (has(/cuantos (congresistas|diputados|senadores)/)) {
      const L = DATA.cong.filter(x => !cam || x.c.camara === cam);
      return A(`Hay <b>${fmt(L.length)}</b> ${cam === "S" ? "senadores" : cam === "D" ? "diputados" : "congresistas"} en el periodo ${esc(R.bi.meta?.periodo)}${cam ? "" : ` (${fmt(DATA.cong.filter(x => x.c.camara === "D").length)} diputados y ${fmt(DATA.cong.filter(x => x.c.camara === "S").length)} senadores)`}.`, "", ["bi"], ["¿Qué bancada presenta más proyectos?", "Presupuesto del Congreso 2026"]);
    }
    if (has(/\b(ranking|top)\b/)) return rankMenu();
    return null;
  }

  /* ── métricas para rankings ── */
  const comCount = it => (it.pf?.comisiones || []).filter(c => c.tipo !== "Grupo parlamentario").length;
  const METRICS = {
    contra: { lab: "votos contra la posición de su bancada", get: it => it.a && it.a.votaciones ? it.a.contra_bancada : null, f: fmt, src: ["pl"], sub: it => `${fmt(it.a.con_bancada)} con su bancada · ${fmt(it.a.votaciones)} votaciones` },
    sinvoto: { lab: "votaciones en las que no votó", get: it => it.a && it.a.votaciones ? it.a.no_voto : null, f: fmt, src: ["pl"] },
    ausencias: { lab: "ausencias al Pleno", get: it => it.a && it.a.pases ? it.a.ausente : null, f: fmt, src: ["pl"], sub: it => `${pct(it.a.pct_asistencia)} de asistencia · ${fmt(it.a.licencia)} licencias` },
    licencias: { lab: "licencias en el Pleno", get: it => it.a && it.a.pases ? it.a.licencia : null, f: fmt, src: ["pl"] },
    asistencia: { lab: "asistencia al Pleno", get: it => it.a && it.a.pases ? it.a.pct_asistencia : null, f: pct, src: ["pl"], max: 100, sub: it => `${fmt(it.a.ausente)} ausencias · ${fmt(it.a.licencia)} licencias · ${fmt(it.a.pases)} pases`, tie: it => it.a.ausente },
    visitas: { lab: "visitas recibidas", get: it => it.vi ? it.vi.total : null, f: fmt, src: ["vis"], sub: it => `${fmt(it.vi.al_congresista)} al congresista · ${fmt(it.vi.dias)} días con visitas` },
    viajes: { lab: "informes de viaje", get: it => it.pf ? (it.pf.viajes || []).length : null, f: fmt, src: ["pf"], nz: true },
    representacion: { lab: "informes de semana de representación", get: it => it.pf ? (it.pf.representacion || []).length : null, f: fmt, src: ["pf"], nz: true },
    comisiones: { lab: "comisiones y órganos (activos)", get: it => it.pf ? comCount(it) : null, f: fmt, src: ["pf"] },
    firmas: { lab: "proyectos firmados como coautor", get: it => it.c.firmas, f: fmt, src: ["bi"] },
    personal: { lab: "personas en el despacho", get: it => it.d ? it.d.personal : null, f: fmt, src: ["mov"], sub: it => `${soles(it.d.masa)} al mes` },
    planilla: { lab: "costo mensual del despacho (planilla)", get: it => it.d ? it.d.masa : null, f: soles, src: ["mov"], sub: it => `${fmt(it.d.personal)} personas` },
    proyectos: { lab: "proyectos como autor principal", get: it => it.c.principal, f: fmt, src: ["bi"], sub: it => `${fmt(it.c.firmas)} firmas como coautor`, tie: it => -it.c.firmas },
  };
  function metricOf(qn) {
    const K = k => Object.assign({ key: k }, METRICS[k]);
    if (/contra (de )?su bancada|contra la bancada|rebelde|disciplin|se aparta/.test(qn)) return K("contra");
    if (/sin votar|no voto|no votaron|no vota\b/.test(qn)) return K("sinvoto");
    if (/ausencia/.test(qn)) return K("ausencias");
    if (/falta|falton|inasist|asist|faltan/.test(qn)) { const m = K("asistencia"); if (/falta|falton|inasist|faltan/.test(qn)) m.dir = /(menos|nunca|no) falta/.test(qn) ? "desc" : "asc"; return m; }
    if (/licencia/.test(qn)) return K("licencias");
    if (/visit/.test(qn)) return K("visitas");
    if (/viaj/.test(qn)) return K("viajes");
    if (/representacion/.test(qn)) return K("representacion");
    if (/\bcomisiones\b/.test(qn)) return K("comisiones");
    if (/firma|coautor/.test(qn)) return K("firmas");
    if (/personal|personas|trabajadores|asesores|equipo/.test(qn)) return K("personal");
    if (/planilla|despacho|gasto|gasta|caro|cuesta|costos?o?s?\b|barato/.test(qn)) return K("planilla");
    if (/proyect|iniciativ|\bleyes\b|productiv/.test(qn)) return K("proyectos");
    return null;
  }
  function ranking(m, cam, n, asc, qn) {
    const camTxt = cam ? (cam === "S" ? "del Senado" : "de la Cámara de Diputados") : "de ambas cámaras";
    const L = DATA.cong.filter(it => (!cam || it.c.camara === cam) && m.get(it) != null)
      .sort((a, b) => (asc ? m.get(a) - m.get(b) : m.get(b) - m.get(a)) || (m.tie ? (asc ? m.tie(b) - m.tie(a) : m.tie(a) - m.tie(b)) : 0) || a.c.nombre.localeCompare(b.c.nombre));
    if (!L.length) return nada(`No hay datos de ${esc(m.lab)} publicados.`, m.src);
    if (m.nz && !asc && m.get(L[0]) > 0) n = Math.min(n, L.filter(it => m.get(it) > 0).length);
    const avg = L.reduce((s, it) => s + m.get(it), 0) / L.length;
    const f = L[0], top = L.slice(0, n);
    // puesto con empates (competición estándar)
    const rows = top.map(it => ({ it, v: m.get(it), rank: L.findIndex(x => m.get(x) === m.get(it)) + 1, sub: m.sub ? `${esc(CAMC[it.c.camara])} · ${m.sub(it)}` : null }));
    const otra = cam === "S" ? "en Diputados" : cam === "D" ? "en el Senado" : "en el Senado";
    const follow = [`${asc ? "Más" : "Menos"} ${m.lab} ${cam === "S" ? "en el Senado" : cam === "D" ? "en Diputados" : ""}`.trim(), `Top 10 ${m.lab} ${otra}`, `Resumen de ${fu(f)}`];
    return A(`${asc ? "Menos" : "Más"} ${esc(m.lab)} ${camTxt}: ${congLink(f)} ${congTag(f)} con <b>${m.f(m.get(f))}</b>. Promedio: ${m.f(m.key === "asistencia" ? Math.round(avg * 10) / 10 : Math.round(avg * 10) / 10)} (${fmt(L.length)} congresistas con datos). Top ${top.length}:`,
      rankList(rows, m.f, m.max != null ? m.max : Math.max(...L.map(m.get))), m.src, follow, null);
  }
  function rankMenu() {
    const ch = ["Top 10 diputados con más proyectos", "¿Quién falta más al Pleno en el Senado?", "Ranking de visitas recibidas", "Despachos más caros del Senado", "¿Quién vota más contra su bancada?", "Top 5 senadores con más comisiones", "Ranking de informes de viaje", "Despachos con más personal"];
    return A("Puedo ordenar a los congresistas por proyectos, firmas, asistencia, ausencias, licencias, votos contra su bancada, visitas, costo o personal del despacho, comisiones, viajes y semana de representación — por cámara o en ambas, con el número que quieras (p. ej. «top 10 senadores con más visitas»).", "", ["bi", "pl"], ch);
  }

  /* ── perfil enriquecido ── */
  function whoHead(it, extra) {
    const c = it.c;
    return `<div class="capb-who">${avatar(it, 52)}<div><a class="capb-wn" href="${congHref(it)}">${esc(nombreNat(c.nombre))}</a><div class="capb-wm">${congTag(it)} <span>${esc(c.camara === "S" ? "Senador(a)" : "Diputado(a)")} · ${esc(c.distrito)}</span></div>${extra || ""}</div></div>`;
  }
  function lastVotes(it, k) {
    if (it.ni == null) return [];
    return DATA.vot.filter(x => x.cam === it.c.camara).slice(0, k).map(x => ({ x, ch: (x.v.votos || "")[it.ni] || "-" }));
  }
  function voteRows(it, L) {
    const sig = it.a?.sigla || it.c.sigla;
    return `<ul class="capb-vl">${L.map(({ x, ch }) => `<li><div class="capb-vh"><span class="capb-mut">${esc(fecha(x.v.fecha))}</span> ${vchip(ch)} <span class="capb-mut">bancada:</span> ${pchip(x.v.posicion?.[sig])}</div><button type="button" class="capb-lk capb-vt" data-q="Votación ${esc(x.v.id)}">${esc(trunc(x.v.asunto || "(asunto no legible en el acta)", 150))}</button><div class="capb-mut">Resultado: ${fmt(x.v.si)} sí · ${fmt(x.v.no)} no · ${fmt(x.v.abst)} abst.</div></li>`).join("")}</ul>`;
  }
  function profile(it) {
    const c = it.c, a = it.a, d = it.d, pf = it.pf, vi = it.vi;
    const same = DATA.cong.filter(x => x.c.camara === c.camara);
    const rank = same.filter(x => x.c.principal > c.principal).length + 1;
    const T = [tile(fmt(c.principal), "proyectos (autor)", `puesto ${rank} de ${fmt(same.length)} · ${fmt(c.firmas)} firmas`)];
    if (a && a.pases) {
      const L = same.filter(x => x.a && x.a.pases), avg = L.reduce((s, x) => s + x.a.pct_asistencia, 0) / (L.length || 1);
      T.push(tile(pct(a.pct_asistencia), "asistencia al Pleno", `promedio ${pct(avg)} · ${fmt(a.ausente)} ausencia${a.ausente === 1 ? "" : "s"}`));
    }
    if (a && a.votaciones) { const tt = a.con_bancada + a.contra_bancada; T.push(tile(tt ? pct(a.con_bancada / tt * 100) : "—", "vota con su bancada", `${fmt(a.contra_bancada)} veces en contra de ${fmt(a.votaciones)}`)); }
    if (vi) T.push(tile(fmt(vi.total), "visitas recibidas", `${fmt(vi.al_congresista)} al congresista`));
    if (d) T.push(tile(soles(d.masa), "despacho al mes", `${fmt(d.personal)} personas en planilla`));
    let body = tiles(T);
    const coms = (pf?.comisiones || []).filter(x => x.tipo !== "Grupo parlamentario").slice().sort((x, y) => CARGO_RANK(x.cargo) - CARGO_RANK(y.cargo));
    if (coms.length) body += h5(`Comisiones (${coms.length})`) + `<ul class="capb-cl">${coms.slice(0, 8).map(x => `<li><span class="capb-role r${CARGO_RANK(x.cargo)}">${esc(x.cargo || "—")}</span> ${esc(trunc(orgName(x.organo), 90))}</li>`).join("")}${coms.length > 8 ? `<li class="capb-mut">y ${coms.length - 8} más…</li>` : ""}</ul>`;
    const lv = lastVotes(it, 3);
    if (lv.length) body += h5("Últimas votaciones del Pleno") + voteRows(it, lv);
    const ps = DATA.proyByAutor[c.nombre] || [];
    if (ps.length) body += h5("Último proyecto") + `<ul class="capb-ul">${projRow(ps[0])}</ul>`;
    body += `<div class="capb-links"><a class="capb-btn" href="${congHref(it)}">Ficha completa</a><a class="capb-btn" href="${explHref(it)}">Ver en el explorador</a></div>`;
    return A(`${esc(nombreNat(c.nombre))} es ${c.camara === "S" ? "senador(a)" : "diputado(a)"} por <b>${esc(c.distrito)}</b> de la bancada <b>${esc(c.bancada)}</b>.`, body, ["bi", "pl", "pf", "vis", "mov"],
      [`¿En qué comisiones está ${fu(it)}?`, `¿Quién visita a ${fu(it)}?`, `Asesores de ${fu(it)}`, `¿Cómo votó ${fu(it)}?`, `Proyectos de ${fu(it)}`], it);
  }
  function despacho(it) {
    const d = it.d;
    if (!d) return nada(`No encontramos el despacho de ${congLink(it)} en la planilla publicada.`, ["mov"]);
    const ult = (d.serie || []).slice(-1)[0];
    const eq = (d.equipo || []).slice().sort((a, b) => b.total - a.total);
    const same = (DATA.R.mov?.despachos || []).filter(x => x.camara === it.c.camara);
    const avg = same.reduce((s, x) => s + x.masa, 0) / (same.length || 1);
    const rank = same.filter(x => x.masa > d.masa).length + 1;
    const max = Math.max(...eq.map(e => e.total), 0);
    return A(`El despacho de ${congLink(it)} ${congTag(it)} tiene <b>${fmt(d.personal)} personas</b> en planilla y cuesta <b>${soles(d.masa)} al mes</b>${ult ? " (" + esc(mesTxt(ult.mes)) + ")" : ""}${d.continuan ? `; ${fmt(d.continuan)} ya trabajaban en el Congreso` : ""}.`,
      tiles([tile(soles(d.masa), "al mes", `promedio ${esc(CAMC[it.c.camara])}: ${soles(avg)}`), tile(fmt(d.personal), "personas"), tile(`${rank}°`, "más costoso", `de ${fmt(same.length)} despachos`)]) +
      (d.serie && d.serie.length > 1 ? h5("Costo mensual") + cols(d.serie.map(s => ({ k: s.mes, lab: mesTxt(s.mes).split(" ")[0], v: s.masa })), soles) : "") +
      h5("Equipo") + `<ul class="capb-team">${eq.map(e => `<li><div><b>${esc(nombreNat(titleCase(e.nombre)))}</b><small>${esc(e.cargo)}</small>${bar(e.total, max)}</div><span>${soles(e.total)}</span></li>`).join("")}</ul>`,
      ["mov"], [`Asesores de ${fu(it)}`, `Resumen de ${fu(it)}`, `Despachos más caros ${it.c.camara === "S" ? "del Senado" : "de Diputados"}`], it);
  }
  function votoResumen(it) {
    const a = it.a;
    if (!a || !a.votaciones) return nada(`No hay votaciones del Pleno registradas para ${congLink(it)}.`, ["pl"]);
    const tt = a.con_bancada + a.contra_bancada;
    return A(`En ${fmt(a.votaciones)} votaciones del Pleno, ${congLink(it)} ${congTag(it)} votó ${fmt(a.si)} a favor, ${fmt(a.no)} en contra y ${fmt(a.abst)} abstenciones (${fmt(a.no_voto)} sin voto). Votó con su bancada ${fmt(a.con_bancada)} veces y en contra ${fmt(a.contra_bancada)}.`,
      tiles([tile(fmt(a.si), "a favor", "", "grn"), tile(fmt(a.no), "en contra", "", "red"), tile(fmt(a.abst), "abstenciones", "", "amb"), tile(fmt(a.no_voto), "sin voto"), tile(tt ? pct(a.con_bancada / tt * 100) : "—", "con su bancada", `${fmt(a.contra_bancada)} en contra`)]) +
      h5("Últimas votaciones") + voteRows(it, lastVotes(it, 5)),
      ["pl"], [`¿Cómo votó ${fu(it)} en estado de emergencia?`, "¿Quién vota más contra su bancada?", `Resumen de ${fu(it)}`], it);
  }
  function proyPersona(it, soloUltimo) {
    const c = it.c, ps = DATA.proyByAutor[c.nombre] || [];
    const rank = DATA.cong.filter(x => x.c.camara === c.camara && x.c.principal > c.principal).length + 1;
    if (soloUltimo) {
      if (!ps.length) return nada(`${congLink(it)} no tiene proyectos como autor principal en el periodo.`, ["bi"]);
      const q = ps[0];
      return A(`El último proyecto de ${congLink(it)} ${congTag(it)} como autor principal es el <b>${esc(q.p.codigo)}</b>, presentado el ${esc(fecha(q.p.fecha))}.`,
        `<div class="capb-det capb-open">${projDetail(q)}</div>` + (ps.length > 1 ? h5("Anteriores") + `<ul class="capb-ul">${ps.slice(1, 4).map(projRow).join("")}</ul>` : ""),
        ["bi"], [`Proyectos de ${fu(it)}`, `Resumen de ${fu(it)}`], it);
    }
    const ag = {};
    ps.forEach(q => { const k = q.p.agenda || "Otros"; ag[k] = (ag[k] || 0) + 1; });
    const agL = Object.entries(ag).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return A(`${congLink(it)} ${congTag(it)} presentó <b>${fmt(c.principal)} proyectos</b> como autor principal y firmó ${fmt(c.firmas)} como coautor (puesto ${rank} de ${fmt(DATA.cong.filter(x => x.c.camara === c.camara).length)} en ${esc(CAMC[c.camara])}).${ps.length ? " Los más recientes:" : ""}`,
      (agL.length ? h5("Por eje temático") + rankList(agL.map(([k, v]) => ({ label: esc(k), v })), fmt) : "") +
      (ps.length ? h5("Recientes") + `<ul class="capb-ul">${ps.slice(0, 5).map(projRow).join("")}</ul>` : ""),
      ["bi"], [`Último proyecto de ${fu(it)}`, `Resumen de ${fu(it)}`, `Top 5 ${c.camara === "S" ? "senadores" : "diputados"} con más proyectos`], it);
  }
  function ambiguous(per, q) {
    const base = q.replace(/\s*·\s*[^·]*$/, "");
    return A(`Hay ${fmt(per.all.length)} congresistas que coinciden con “${esc(q)}”. ¿A quién te refieres?`,
      `<ul class="capb-ul">${per.all.slice(0, 8).map(it => `<li><button type="button" class="capb-row capb-chip-row" data-q="${esc(base + " · " + nombreNat(it.c.nombre))}">${avatar(it, 30)}<span><b>${esc(nombreNat(it.c.nombre))}</b> ${congTag(it)}<br><span class="capb-mut">${esc(CAMC[it.c.camara])} · ${esc(it.c.distrito)}</span></span></button></li>`).join("")}</ul>`, ["bi"]);
  }

  /* ── comparar ── */
  function compare(q, qn) {
    const parts = qn.replace(/\b(compara(r|cion|me)?|comparativa|diferencias? entre|entre|frente a|versus|vs|a|al|los|las|congresistas?)\b/g, " ").split(/\s+(?:con|y|e|contra)\s+|,/).map(s => s.trim()).filter(Boolean);
    const found = [];
    const add = it => { if (it && !found.includes(it) && found.length < 4) found.push(it); };
    for (const p of parts) { const r = findPerson(p); if (r) { if (r.all.length > 1 && r.score < 5) return ambiguous(r, q); add(r.best); } }
    if (found.length < 2) {
      const r = findPerson(q);
      if (found.length < 2) return A("Para comparar necesito dos congresistas. Escribe, por ejemplo: «compara Zunini con Columbus».", r ? `<p class="capb-mut">Encontré a ${congLink(r.best)}; ¿con quién quieres compararlo?</p>` : "", ["bi"], r ? [`Compara ${fu(r.best)} con ${fu(DATA.cong.find(x => x !== r.best && x.c.camara === r.best.c.camara))}`] : []);
    }
    const best = (vals, hi) => { const ok = vals.filter(v => v != null); if (ok.length < 2) return -1; const t = hi ? Math.max(...ok) : Math.min(...ok); return vals.filter(v => v === t).length === vals.length ? -1 : t; };
    const rows = [
      ["Proyectos (autor)", it => it.c.principal, fmt, true],
      ["Firmas (coautor)", it => it.c.firmas, fmt, true],
      ["Asistencia al Pleno", it => it.a && it.a.pases ? it.a.pct_asistencia : null, pct, true],
      ["Ausencias", it => it.a && it.a.pases ? it.a.ausente : null, fmt, false],
      ["Votos contra su bancada", it => it.a && it.a.votaciones ? it.a.contra_bancada : null, fmt, null],
      ["Visitas recibidas", it => it.vi ? it.vi.total : null, fmt, null],
      ["Despacho (S/ al mes)", it => it.d ? it.d.masa : null, soles, null],
      ["Personal del despacho", it => it.d ? it.d.personal : null, fmt, null],
      ["Comisiones", it => it.pf ? comCount(it) : null, fmt, null],
    ];
    const head = `<tr><th scope="col"></th>${found.map(it => `<th scope="col"><div class="capb-cmph">${avatar(it, 34)}<a class="capb-l" href="${congHref(it)}">${esc(apellidos(it.c.nombre))}</a>${congTag(it)}<small>${esc(CAMC[it.c.camara])}</small></div></th>`).join("")}</tr>`;
    const body = rows.map(([lab, g, f, hi]) => {
      const vals = found.map(g), b = hi == null ? -1 : best(vals, hi);
      return `<tr><th scope="row">${lab}</th>${vals.map(v => `<td class="n${v === b ? " capb-best" : ""}">${v == null ? "—" : f(v)}</td>`).join("")}</tr>`;
    }).join("");
    const link = `index.html#comparar?c=${found.map(it => encodeURIComponent(it.slug)).join(",")}`;
    return A(`Comparación de ${found.map(it => `<b>${esc(nombreNat(it.c.nombre))}</b>`).join(found.length === 2 ? " y " : ", ")}. Resaltado: mejor valor en proyectos, firmas, asistencia y ausencias.`,
      `<div class="capb-tw"><table class="capb-t capb-cmpt"><thead>${head}</thead><tbody>${body}</tbody></table></div><div class="capb-links"><a class="capb-btn" href="${esc(link)}">Abrir comparación completa →</a></div>`,
      ["bi", "pl", "vis", "mov", "pf"], found.map(it => `Resumen de ${fu(it)}`).slice(0, 2).concat([`¿Cómo votó ${fu(found[0])}?`]));
  }

  /* ── presupuesto y planilla ── */
  function presupuesto(qn) {
    const P = DATA.R.ctx?.presupuesto;
    if (!P || !P.serie?.length) return nada("No tengo la serie de presupuesto del Congreso cargada.", []);
    const ym = /\b(20\d\d)\b/.exec(qn);
    const S = P.serie;
    let r = ym ? S.find(s => s.anio === +ym[1]) : S[S.length - 1];
    const noYear = ym && !r;
    if (!r) r = S[S.length - 1];
    const prev = S.find(s => s.anio === r.anio - 1), first = S[0];
    const mov = DATA.R.mov, ult = (mov?.serie || []).slice(-1)[0];
    const txt = (noYear ? `No hay dato para ${esc(ym[1])}; la serie va de ${first.anio} a ${S[S.length - 1].anio}. ` : "") +
      `El presupuesto del Congreso (pliego 028) para <b>${r.anio}</b>: PIA <b>${millones(r.pia)}</b>, PIM ${millones(r.pim)} y devengado ${millones(r.devengado)} (${pct(r.avance)} de ejecución)` +
      (prev ? `; el PIA ${r.pia >= prev.pia ? "subió" : "bajó"} ${pct(Math.abs(r.pia / prev.pia - 1) * 100)} frente a ${prev.anio}` : "") + ".";
    return A(txt,
      tiles([tile(millones(r.pia), "PIA (apertura)"), tile(millones(r.pim), "PIM (modificado)"), tile(millones(r.devengado), "devengado"), tile(pct(r.avance), "ejecución")]) +
      h5(`PIA por año (millones de soles) · ${first.anio}–${S[S.length - 1].anio}`) + cols(S.map(s => ({ k: String(s.anio), lab: "’" + String(s.anio).slice(2), v: s.pia })), v => millones(v), String(r.anio)) +
      (ult ? `<p class="capb-mut">Planilla activa en ${esc(mesTxt(ult.mes))}: ${fmt(ult.activos)} personas y ${soles(ult.masa)} al mes (planilla nominal PTE).</p>` : "") +
      ((P.destacados || []).length ? `<ul class="capb-bul">${P.destacados.slice(0, 3).map(d => `<li>${esc(d)}</li>`).join("")}</ul>` : ""),
      ["ctx", "mov"], [`Presupuesto del Congreso ${r.anio === S[S.length - 1].anio ? S[S.length - 2]?.anio : S[S.length - 1].anio}`, "Planilla total del Congreso", "¿Cuántos trabajadores tiene el Congreso?"]);
  }
  function planillaTotal() {
    const M = DATA.R.mov;
    if (!M || !M.serie?.length) return nada("No tengo la planilla del Congreso cargada.", []);
    const S = M.serie, u = S[S.length - 1], p = S[S.length - 2];
    const des = M.despachos || [];
    const dm = des.reduce((s, d) => s + d.masa, 0), dp = des.reduce((s, d) => s + d.personal, 0);
    return A(`En ${esc(mesTxt(u.mes))} el Congreso tenía <b>${fmt(u.activos)} trabajadores activos</b> en planilla, con una planilla total de <b>${soles(u.masa)} al mes</b>` +
      (p ? ` (${u.activos >= p.activos ? "+" : ""}${fmt(u.activos - p.activos)} personas frente a ${esc(mesTxt(p.mes))})` : "") + `. Los ${fmt(des.length)} despachos congresales suman ${fmt(dp)} personas y ${soles(dm)} al mes.`,
      tiles([tile(fmt(u.activos), "trabajadores", esc(mesTxt(u.mes))), tile(soles(u.masa), "planilla mensual"), tile(fmt(dp), "en despachos", `${soles(dm)} al mes`)]) +
      h5("Trabajadores activos por mes") + cols(S.map(s => ({ k: s.mes, lab: mesTxt(s.mes).split(" ")[0], v: s.activos })), fmt, u.mes) +
      h5("Planilla mensual") + cols(S.map(s => ({ k: s.mes, lab: mesTxt(s.mes).split(" ")[0], v: s.masa })), soles, u.mes) +
      `<p class="capb-mut">Planilla activa (sin pensionistas) según la planilla nominal del Portal de Transparencia Estándar.</p>`,
      ["mov"], ["Despachos más caros del Senado", "Presupuesto del Congreso 2026", "Despachos con más personal"]);
  }
  function historico(qn, n) {
    const H = DATA.R.hist, t = H.totales || {};
    if (/bancad|partido/.test(qn)) {
      const L = (H.bancadas || []).slice(0, topN(qn, 10));
      return A(`En el Congreso 2021–2026 la bancada con más proyectos fue <b>${esc(L[0]?.bancada)}</b> con ${fmt(L[0]?.proyectos)} proyectos y ${fmt(L[0]?.leyes)} leyes.`,
        rankList(L.map(b => ({ label: esc(b.bancada), sub: `${fmt(b.leyes)} leyes · ${pct(b.pct_ley)} se volvió ley · ${pct(b.pct_simbolico)} simbólicos`, v: b.proyectos })), fmt), ["hist"], ["¿Quién presentó más proyectos en 2021-2026?", "¿Qué bancada presenta más proyectos?"]);
    }
    if (/quien|autor|congresista|mas proyectos|top|ranking/.test(qn)) {
      const L = (H.top_autores || []).slice(0, topN(qn, 10));
      return A(`En el Congreso 2021–2026 el autor con más proyectos fue <b>${esc(nombreNat(L[0]?.nombre))}</b> con ${fmt(L[0]?.proyectos)}.`,
        rankList(L.map(x => ({ label: esc(nombreNat(x.nombre)), v: x.proyectos })), fmt), ["hist"], ["Bancadas del Congreso 2021-2026", "Top 5 diputados con más proyectos"]);
    }
    return A(`El Congreso 2021–2026 registró <b>${fmt(t.proyectos)} proyectos</b> y <b>${fmt(t.leyes_aprobadas)} leyes</b> aprobadas, de ${fmt(t.autores_unicos)} autores.`,
      h5("Proyectos por año") + cols(Object.entries(H.por_anio || {}).map(([y, v]) => ({ k: y, lab: "’" + y.slice(2), v })), fmt), ["hist"], ["Bancadas del Congreso 2021-2026", "¿Quién presentó más proyectos en 2021-2026?"]);
  }

  /* ── votaciones del Pleno ── */
  const VSTOP = new Set(("como voto vota votaron votado votacion votaciones votar en contra favor abstuvo abstuvieron abstencion abstenciones abstuvieron quienes quien que cual cuales sobre tema " +
    "de del la el los las y o a al por para su sus fue se dijo dio pleno congreso senado camara diputados senadores diputado senador congresista congresistas resultado resultados " +
    "nominal lista ley proyecto proyectos dia fecha mes ano cuando hubo hay hizo ha han ese esa este esta lo le les un una mas menos sobre ultima ultimo ultimas ultimos reciente recientes " +
    "mostrar muestra ver dime que con sin todos todas cada bancada bancadas votos").split(" "));
  function votos(q, qn, cam, n) {
    const per = findPerson(q);
    if (per && per.all.length > 1 && per.score < 5) return ambiguous(per, q);
    const it = per ? per.best : null;
    const fd = parseFecha(q);
    const nt = it ? nameToks(qn, it) : new Set();
    const toks = words(qn).filter(t => !VSTOP.has(t) && !Q_STOP.has(t) && !nt.has(t) && !(fd && fd.used.has(t)) && (t.length >= 3 || /^\d+$/.test(t)));
    const ultima = /\bultim[ao]s?\b|reciente/.test(qn);
    if (!it && /\b(top|ranking|mas|menos)\b/.test(qn) && /contra (de )?(su|la) bancada|sin votar|no vot/.test(qn)) return null; // ranking
    const vcam = it ? it.c.camara : cam;
    if (!toks.length && !fd && !ultima) return null; // sin tema → otras intenciones
    let L = DATA.vot.filter(x => (!vcam || x.cam === vcam) && (!fd || fd.test(x.v.fecha)));
    let ks = toks.map(t => (/^\d+$/.test(t) ? t : stem(t)));
    if (ks.length) {
      const need = Math.max(1, Math.ceil(ks.length * 0.6));
      L = L.map(x => ({ x, h: kwHits(ks, x.ws) })).filter(o => o.h >= need).sort((a, b) => b.h - a.h || (b.x.v.fecha || "").localeCompare(a.x.v.fecha || "")).map(o => o.x);
    }
    const temaTxt = (toks.length ? `“${esc(toks.join(" "))}”` : "") + (fd ? `${toks.length ? " el " : "el "}${esc(fd.txt)}` : "");
    if (!L.length) {
      if (!toks.length && !fd) return null;
      return A(`No encontré votaciones del Pleno ${vcam ? (vcam === "S" ? "del Senado " : "de Diputados ") : ""}sobre ${temaTxt || "ese tema"}. Las actas registran ${fmt(DATA.vot.filter(x => !vcam || x.cam === vcam).length)} votaciones nominales.`,
        h5("Últimas votaciones") + voteList(DATA.vot.filter(x => !vcam || x.cam === vcam).slice(0, 5)), ["pl"], ["Última votación del Senado", "¿Quiénes votaron en contra del reglamento del Senado?"], it);
    }
    if (it) {
      if (it.ni == null) return nada(`No encontré a ${congLink(it)} en la lista nominal del Pleno.`, ["pl"]);
      const sel = L.slice(0, 6).map(x => ({ x, ch: (x.v.votos || "")[it.ni] || "-" }));
      const cnt = {}; sel.forEach(s => { cnt[s.ch] = (cnt[s.ch] || 0) + 1; });
      const first = sel[0];
      return A(`${L.length === 1 ? "En la votación" : `Encontré ${fmt(L.length)} votaciones ${temaTxt ? "sobre " + temaTxt : ""}. En la más relevante`} del ${esc(fecha(first.x.v.fecha))}, ${congLink(it)} ${congTag(it)} votó ${vchip(first.ch)}; su bancada votó ${pchip(first.x.v.posicion?.[it.a?.sigla || it.c.sigla])}.`,
        voteRows(it, sel) + (L.length > 6 ? `<p class="capb-mut">Y ${fmt(L.length - 6)} votaciones más con esas palabras.</p>` : ""),
        ["pl"], [`¿Quiénes votaron en contra ${toks.length ? "de " + toks.join(" ") : "en la votación " + first.x.v.id}?`, `¿Cómo votó ${fu(it)}?`, `Resumen de ${fu(it)}`], it);
    }
    // sin persona: detalle nominal de la más relevante + lista de otras
    const x = L[0];
    const extra = L.length > 1 ? h5(`Otras ${fmt(Math.min(L.length - 1, 5))} votaciones que coinciden${L.length > 6 ? ` (de ${fmt(L.length - 1)})` : ""}`) + voteList(L.slice(1, 6)) : "";
    return voteCard(x, qn, extra, ks.length || fd ? L.length : 1);
  }
  function voteList(L) {
    return `<ul class="capb-vl">${L.map(x => `<li><div class="capb-vh"><span class="capb-mut">${esc(fecha(x.v.fecha))} · ${esc(CAMC[x.cam])}</span> <span class="capb-mut">${fmt(x.v.si)} sí · ${fmt(x.v.no)} no · ${fmt(x.v.abst)} abst.</span></div><button type="button" class="capb-lk capb-vt" data-q="Votación ${esc(x.v.id)}">${esc(trunc(x.v.asunto || "(asunto no legible en el acta)", 150))}</button></li>`).join("")}</ul>`;
  }
  function voteCard(x, qn, extra, total) {
    const v = x.v, orden = DATA.R.pl?.camaras?.[x.cam]?.nominal_orden || [];
    const G = { S: [], N: [], A: [], X: [], L: [], R: [], P: [], "-": [] };
    orden.forEach((nm, i) => { const ch = (v.votos || "")[i] || "-"; (G[ch] || G["-"]).push(DATA.byName[x.cam + "|" + nm] || { c: { nombre: nm }, slug: slug(nm) }); });
    const want = /a favor|votaron si|\bsi\b/.test(qn) ? ["S"] : /abstuv|abstencion/.test(qn) ? ["A"] : /ausent|no vot|faltaron/.test(qn) ? ["X", "L"] : /en contra|votaron no|\bno\b/.test(qn) ? ["N"] : ["N", "A"];
    const names = L => L.map(it => it.c.camara ? `<a class="capb-l" href="${congHref(it)}">${esc(nombreNat(it.c.nombre))}</a> ${congTag(it)}` : esc(nombreNat(it.c.nombre))).join(", ");
    let lists = "";
    want.forEach(ch => { const L = G[ch]; lists += h5(`${VOTO[ch][0]} (${fmt(L.length)})`) + (L.length ? `<p class="capb-names">${names(L)}</p>` : `<p class="capb-mut">Nadie.</p>`); });
    if (!want.includes("S") && G.S.length && G.S.length <= 12) lists += h5(`Sí (${fmt(G.S.length)})`) + `<p class="capb-names">${names(G.S)}</p>`;
    const nomOK = G.S.length === (v.si || 0) && G.N.length === (v.no || 0) && G.A.length === (v.abst || 0);
    const pb = Object.entries(v.por_bancada || {}).sort((a, b) => Object.values(b[1]).reduce((s, n) => s + n, 0) - Object.values(a[1]).reduce((s, n) => s + n, 0));
    const tb = pb.length ? h5("Por bancada") + table(["Bancada", "Sí", "No", "Abst.", "Aus.", "Posición"], pb.map(([s, o]) => [bchip(s, (DATA.banc.find(b => b.sigla === s) || {}).bancada), fmt(o.si), fmt(o.no), fmt(o.abst), fmt(o.ausente), pchip(v.posicion?.[s])])) : "";
    const lead = total > 1 ? `Encontré ${fmt(total)} votaciones; la más reciente y relevante es del` : "Votación del";
    return A(`${lead} <b>${esc(fecha(v.fecha))}</b> ${esc(v.hora || "")} en el Pleno ${x.cam === "S" ? "del Senado" : "de la Cámara de Diputados"}: <b>${fmt(v.si)} a favor, ${fmt(v.no)} en contra y ${fmt(v.abst)} abstenciones</b>.`,
      `<p class="capb-asunto">${esc(v.asunto || "(asunto no legible en el acta)")}</p>` + stack(v) + lists + tb +
      (nomOK ? "" : `<p class="capb-mut">La lista nominal se lee del acta escaneada (OCR) y puede no coincidir exactamente con los totales oficiales.</p>`) + (extra || ""),
      ["pl"], [want.includes("S") ? `¿Quiénes votaron en contra en la votación ${v.id}?` : `¿Quiénes votaron a favor en la votación ${v.id}?`, `¿Quiénes se abstuvieron en la votación ${v.id}?`, `Última votación ${x.cam === "S" ? "del Senado" : "de Diputados"}`]);
  }

  /* ── proyectos con filtros ── */
  function proyectos(q, qn, cam, n, asc) {
    const tm0 = /\b(?:sobre|acerca de|relacionad[oa]s? (?:con|a)|en materia de|con el tema|que mencionan?|que hablan de|referidos? a|para)\s+(.+)$/.exec(qn);
    const per = findPerson(tm0 ? qn.slice(0, tm0.index) : q);
    const banc = findBancada(qn);
    const rf = /riesgo fiscal|costo fiscal|impacto fiscal|gasto fiscal|irresponsab/.test(qn);
    // comisión (de bicameral.json; los índices `com` apuntan a camaras[cam].comisiones)
    let com = null;
    const cm = /\bcomision(?:es)?\s+(?:de |del |en )?(?:la |el |los |las )?(.+?)(?:\s+(?:sobre|acerca|en el senado|en diputados|del senado|de diputados)\b.*)?$/.exec(qn);
    if (cm && !/^(que|cual)/.test(cm[1])) com = findBiCom(cm[1], cam);
    // "último proyecto de X"
    if (per && !banc && /\bultim[oa]\b|mas reciente/.test(qn)) { if (per.all.length > 1 && per.score < 5) return ambiguous(per, q); return proyPersona(per.best, true); }
    let kw = null;
    if (tm0) kw = tm0[1];
    else if (!per && !banc && !com && !rf) {
      const m2 = /\b(?:proyectos?|iniciativas|propuestas|leyes|proposiciones)\s+(?:de ley\s+)?(?:de|del|en)\s+(.+)$/.exec(qn);
      if (m2 && !/^(la |el |los |las )?(camara|senado|congreso|diputad|senador|ley$|mas|menos)/.test(m2[1])) kw = m2[1];
    }
    if (kw) {
      if (banc) banc.kws.forEach(k => { kw = kw.replace(new RegExp("\\b" + k + "\\b", "g"), " "); });
      kw = kw.replace(/\b(en |de |del )?(el |la )?(senado|camara de diputados|diputados|congreso)\b/g, " ").replace(/\b(el|la|los|las|y|o|en|de|del|ley|leyes|proyectos?|riesgo|fiscal)\b/g, " ").replace(/\s+/g, " ").trim();
      if (!kw || /^(mas|menos)\b/.test(kw)) kw = null;
    }
    if (per && !kw && !banc && !com && !rf) return null; // lo atiende "proyectos de X"
    if (!kw && !banc && !com && !rf) return null;
    const ks = kw ? words(kw).filter(t => t.length >= 3 && !Q_STOP.has(t)).map(stem) : [];
    if (kw && !ks.length) return null;
    const pcam = com ? com.cam : cam;
    const L = DATA.proy.filter(x => (!pcam || x.p.camara === pcam) && (!rf || x.p.riesgo_fiscal) && (!banc || (x.autor && x.autor.c.bancada === banc.bancada)) &&
      (!com || (x.p.camara === com.cam && x.coms.includes(com.nombre))) && (!per || (x.autor === per.best)) && (!ks.length || ks.every(k => x.ws.some(w => w.startsWith(k)))))
      .sort((a, b) => (b.p.fecha || "").localeCompare(a.p.fecha || "") || b.p.codigo.localeCompare(a.p.codigo));
    const filt = [kw ? `cuyo título menciona “${esc(kw)}”` : "", banc ? `de autores de ${bchip(banc.sigla, banc.bancada)} ${esc(banc.bancada)}` : "", com ? `derivados a la comisión de <b>${esc(com.nombre)}</b> (${esc(CAMC[com.cam])})` : "", rf ? "con <b>riesgo fiscal</b> (crean gasto o renuncian a ingresos; inferido por palabras clave del título)" : "", per ? `de ${congLink(per.best)}` : "", pcam && !com ? `en ${esc(CAM[pcam])}` : ""].filter(Boolean).join(", ");
    const lc = pcam || (L.length && L.every(x => x.p.camara === "S") ? "S" : "D");
    const hp = new URLSearchParams(); hp.set("cam", lc);
    if (banc) hp.set("banc", banc.bancada); if (com) hp.set("com", com.nombre); if (rf) hp.set("rf", "1"); if (kw) hp.set("pq", kw);
    const link = `<div class="capb-links"><a class="capb-btn" href="index.html#bicameral?${esc(hp.toString())}">Ver en el explorador de proyectos →</a></div>`;
    if (!L.length) return A(`No encontramos proyectos ${filt}.`, link, ["bi"], ["Proyectos con riesgo fiscal", "Proyectos sobre salud"]);
    const est = {}, bb = {};
    L.forEach(x => { const e = x.p.estado || "—"; est[e] = (est[e] || 0) + 1; if (x.autor) bb[x.autor.c.sigla] = (bb[x.autor.c.sigla] || 0) + 1; });
    const estL = Object.entries(est).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const bbL = Object.entries(bb).sort((a, b) => b[1] - a[1]);
    const k = Math.max(n, 8);
    return A(`Hay <b>${fmt(L.length)} proyecto${L.length === 1 ? "" : "s"}</b> ${filt}. ${L.length > k ? `Los ${k} más recientes:` : ""}`,
      h5("Por estado") + rankList(estL.map(([e, v]) => ({ label: esc(e), v })), fmt, L.length) +
      (!banc && bbL.length > 1 ? h5("Por bancada del autor") + rankList(bbL.map(([s, v]) => ({ label: `${bchip(s, (DATA.banc.find(b => b.sigla === s) || {}).bancada)} ${esc((DATA.banc.find(b => b.sigla === s) || {}).bancada || s)}`, v })), fmt) : "") +
      h5("Recientes") + `<ul class="capb-ul">${L.slice(0, k).map(projRow).join("")}</ul>` + link,
      ["bi"], [rf ? "Proyectos de Fuerza Popular con riesgo fiscal" : "Proyectos con riesgo fiscal", banc ? `Proyectos de ${banc.bancada} sobre educación` : "Proyectos de Renovación Popular sobre seguridad", com ? `Miembros de la comisión de ${com.nombre}` : "Proyectos de la comisión de Salud"]);
  }
  function findBiCom(txt, cam) {
    const ks = words(txt).filter(t => !ORG_STOP.has(t) && t.length >= 3 && !["proyectos", "senado", "diputados", "camara", "sobre"].includes(t)).map(stem);
    if (!ks.length) return null;
    let best = null, bs = 0;
    ["D", "S"].forEach(c => { if (cam && cam !== c) return; (DATA.R.bi?.camaras?.[c]?.comisiones || []).forEach(x => {
      const s = kwHits(ks, words(x.nombre));
      if (s > bs || (s === bs && s && best && x.proyectos > best.proyectos)) { bs = s; best = { cam: c, nombre: x.nombre, proyectos: x.proyectos }; }
    }); });
    return bs >= Math.max(1, Math.ceil(ks.length * 0.6)) ? best : null;
  }

  /* ── comisiones ── */
  function findOrg(txt, cam) {
    const ks = words(txt).filter(t => !ORG_STOP.has(t) && t.length >= 3 && !["quien", "quienes", "preside", "presidente", "presidenta", "miembros", "integrantes", "senado", "diputados", "camara", "congreso", "esta", "estan", "forman", "son", "parte", "que", "cual"].includes(t)).map(stem);
    if (!ks.length) return [];
    const sc = DATA.org.filter(o => !cam || o.cam === cam || o.cam === "C").map(o => ({ o, s: kwHits(ks, o.ws) })).filter(x => x.s >= Math.max(1, Math.ceil(ks.length * 0.6)));
    if (!sc.length) return [];
    const top = Math.max(...sc.map(x => x.s));
    // a igual puntaje, preferir el nombre más corto (más específico) y no los órganos directivos
    const L = sc.filter(x => x.s === top).sort((a, b) => (a.o.tipo === "Órgano directivo") - (b.o.tipo === "Órgano directivo") || a.o.kws.length - b.o.kws.length);
    const minLen = L[0].o.kws.length;
    return L.filter(x => x.o.kws.length === minLen).map(x => x.o);
  }
  function comisiones(q, qn, cam) {
    const per = findPerson(q);
    const presi = /\bpreside|presidente|presidenta|\bquien dirige|quien encabeza/.test(qn);
    const miem = /miembros|integrantes|quienes (estan|son|integran|forman)|conforman|integran|composicion/.test(qn);
    // persona + comisiones
    if (per && !presi && !miem) {
      if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
      const it = per.best, cs = (it.pf?.comisiones || []).filter(x => x.tipo !== "Grupo parlamentario").slice().sort((a, b) => CARGO_RANK(a.cargo) - CARGO_RANK(b.cargo));
      if (!it.pf) return nada(`No hay perfil publicado para ${congLink(it)}.`, ["pf"]);
      const pres = cs.filter(x => CARGO_RANK(x.cargo) === 0);
      return A(`${congLink(it)} ${congTag(it)} integra <b>${fmt(cs.length)} comisiones u órganos</b> activos${pres.length ? `; preside ${pres.map(x => `<b>${esc(orgName(x.organo))}</b>`).join(" y ")}` : ""}.`,
        `<ul class="capb-cl">${cs.map(x => `<li><span class="capb-role r${CARGO_RANK(x.cargo)}">${esc(x.cargo || "—")}</span> ${esc(orgName(x.organo))} <span class="capb-mut">· ${esc(x.tipo)}${x.desde ? " · desde " + esc(fecha(x.desde)) : ""}</span></li>`).join("")}</ul>`,
        ["pf"], [cs[0] ? `Miembros de la ${cs[0].organo.replace(/\.\s*$/, "")}` : "¿Quién preside la comisión de Salud?", `Resumen de ${fu(it)}`, "Top 10 congresistas con más comisiones"], it);
    }
    const presCam = /presidente|presidenta/.test(qn) && /\b(del|de la) (senado|camara|congreso)\b/.test(qn) && !/comision/.test(qn);
    const txt = presCam ? "mesa directiva" : (/\bcomision(?:es)?\s+(?:de |del |en )?(.+)$/.exec(qn) || [null, qn])[1];
    const os = findOrg(txt, cam);
    if (!os.length) {
      if (/^(las |cuales son las |que |lista de )?comisiones( ordinarias)?( del senado| de diputados| de la camara de diputados)?$/.test(qn.replace(/^(cuales|que) (son )?/, "")) || /^comisiones\b/.test(qn)) {
        const L = DATA.org.filter(o => (!cam || o.cam === cam) && o.tipo === "Ordinaria").sort((a, b) => a.cam.localeCompare(b.cam) || (b.bic?.proyectos || 0) - (a.bic?.proyectos || 0));
        return A(`Hay ${fmt(L.length)} comisiones ordinarias ${cam ? (cam === "S" ? "en el Senado" : "en Diputados") : "entre ambas cámaras"} con integrantes publicados.`,
          `<ul class="capb-ul">${L.map(o => `<li><button type="button" class="capb-row" data-q="${esc("Miembros de la " + (/^comisi/i.test(o.nombre) ? o.nombre : "Comisión de " + o.nombre) + (o.cam === "S" ? " del Senado" : o.cam === "D" ? " de Diputados" : ""))}"><b>${esc(o.nombre)}</b> <span class="capb-mut">· ${esc(CAMC[o.cam])} · ${fmt(o.miembros.length)} integrantes${o.bic ? " · " + fmt(o.bic.proyectos) + " proyectos" : ""}</span></button></li>`).join("")}</ul>`, ["pf", "bi"], ["¿Quién preside la comisión de Salud?", "Proyectos de la comisión de Justicia"]);
      }
      return null;
    }
    if (presi || presCam) {
      const rows = os.map(o => ({ o, p: o.miembros.filter(m => CARGO_RANK(m.cargo) === 0) }));
      const txtP = rows.map(({ o, p }) => p.length ? `${p.map(m => `${congLink(m.it)} ${congTag(m.it)}`).join(" y ")} preside${p.length > 1 ? "n" : ""} <b>${esc(o.nombre)}</b> (${esc(CAMC[o.cam])})` : `No hay presidente publicado para <b>${esc(o.nombre)}</b> (${esc(CAMC[o.cam])})`).join("; ") + ".";
      const body = rows.map(({ o }) => h5(`${esc(o.nombre)} · ${esc(CAMC[o.cam])}`) + `<ul class="capb-cl">${o.miembros.filter(m => CARGO_RANK(m.cargo) <= 2).map(m => `<li>${avatar(m.it, 24)} <span class="capb-role r${CARGO_RANK(m.cargo)}">${esc(m.cargo)}</span> ${congLink(m.it)} ${congTag(m.it)}</li>`).join("")}</ul>` +
        (o.bic ? `<p class="capb-mut">${fmt(o.bic.proyectos)} proyectos derivados a esta comisión.</p>` : "")).join("");
      const p0 = rows.find(r => r.p.length)?.p[0];
      return A(txtP, body, ["pf", "bi"], [`Miembros de la ${/^comisi/i.test(os[0].nombre) ? os[0].nombre : "comisión de " + os[0].nombre}`, os[0].bic ? `Proyectos de la comisión de ${os[0].bic.nombre}` : "Comisiones del Senado", p0 ? `Resumen de ${fu(p0.it)}` : "Comisiones de Diputados"], p0 ? p0.it : null);
    }
    // miembros (por defecto)
    const o = os[0];
    const grupos = {};
    o.miembros.forEach(m => { const r = CARGO_RANK(m.cargo); (grupos[r] = grupos[r] || []).push(m); });
    const lab = { 0: "Presidencia", 1: "Vicepresidencia", 2: "Secretaría", 3: "Titulares", 4: "Suplentes", 5: "Otros" };
    const bb = {}; o.miembros.forEach(m => { bb[m.it.c.sigla] = (bb[m.it.c.sigla] || 0) + 1; });
    return A(`<b>${esc(o.nombre)}</b> (${esc(CAMC[o.cam])}) tiene <b>${fmt(o.miembros.length)} integrantes</b> publicados${o.bic ? ` y ${fmt(o.bic.proyectos)} proyectos derivados` : ""}.${os.length > 1 ? ` También existe en ${os.slice(1).map(x => esc(CAMC[x.cam])).join(" y ")}.` : ""}`,
      h5("Por bancada") + rankList(Object.entries(bb).sort((a, b) => b[1] - a[1]).map(([s, v]) => ({ label: `${bchip(s, (DATA.banc.find(b => b.sigla === s) || {}).bancada)} ${esc((DATA.banc.find(b => b.sigla === s) || {}).bancada || s)}`, v })), fmt) +
      Object.keys(grupos).sort().map(r => h5(`${lab[r]} (${grupos[r].length})`) + `<p class="capb-names">${grupos[r].map(m => `${congLink(m.it)} ${congTag(m.it)}${+r <= 2 ? ` <span class="capb-mut">(${esc(m.cargo)})</span>` : ""}`).join(", ")}</p>`).join(""),
      ["pf", "bi"], [`¿Quién preside la ${/^comisi/i.test(o.nombre) ? o.nombre : "comisión de " + o.nombre}${o.cam === "S" ? " del Senado" : o.cam === "D" ? " de Diputados" : ""}?`, o.bic ? `Proyectos de la comisión de ${o.bic.nombre}${o.cam === "S" ? " del Senado" : ""}` : "Comisiones del Senado", "Top 10 congresistas con más comisiones"]);
  }

  /* ── visitas ── */
  const VIS_STOP = new Set("visita visitas visitan visito visitaron visitar recibe reciben recibio recibieron quien quienes que cual cuales mas menos congreso congresista congresistas institucion instituciones entidad entidades empresa empresas a al de del la el los las en por para lo le sus su ha han hay mayor top ranking registra registran tiene tienen cuantas cuantos senado diputados senador senadores diputado camara".split(" "));
  function visitas(q, qn, cam, n, asc) {
    const V = DATA.R.vis;
    if (!V) return nada("No tengo el registro de visitas cargado.", []);
    const per = findPerson(q);
    if (per) {
      if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
      const it = per.best, v = it.vi;
      if (!v) return nada(`No hay visitas registradas para ${congLink(it)}.`, ["vis"]);
      const same = DATA.cong.filter(x => x.c.camara === it.c.camara && x.vi);
      const rank = same.filter(x => x.vi.total > v.total).length + 1;
      const te = (v.top_entidades || []).slice(0, 8);
      const ul = (v.ultimas || []).slice(0, 6);
      return A(`${congLink(it)} ${congTag(it)} recibió <b>${fmt(v.total)} visitas</b> desde el ${esc(fecha(V.meta?.desde))} (${fmt(v.al_congresista)} dirigidas a él/ella y el resto a su despacho), en ${fmt(v.dias)} días. Puesto ${rank} de ${fmt(same.length)} en ${esc(CAMC[it.c.camara])}.`,
        tiles([tile(fmt(v.total), "visitas"), tile(fmt(v.al_congresista), "al congresista"), tile(fmt(v.dias), "días con visitas"), tile(`${rank}°`, "puesto", `en ${esc(CAMC[it.c.camara])}`)]) +
        (v.por_mes ? h5("Visitas por mes") + cols(Object.entries(v.por_mes).map(([m, c]) => ({ k: m, lab: mesTxt(m).split(" ")[0], v: c })), fmt) : "") +
        (te.length ? h5("Instituciones que más lo/la visitan") + rankList(te.map(([e, c]) => ({ label: esc(titleCase(e)), v: c })), fmt) : "") +
        (ul.length ? h5("Últimas visitas") + table(["Fecha", "Visitante", "Entidad", "Motivo"], ul.map(u => [esc(fecha(u.fecha)) + (u.hora ? ` <span class="capb-mut">${esc(u.hora)}</span>` : ""), esc(nombreNat(titleCase(u.visitante))), esc(u.entidad || "—"), esc(trunc(u.motivo || "—", 60))])) : ""),
        ["vis"], [`Resumen de ${fu(it)}`, "¿Qué congresista recibe más visitas?", "¿Qué instituciones visitan más el Congreso?"], it);
    }
    // ¿quién recibe visitas de <entidad>?
    const ks = words(qn).filter(t => t.length >= 3 && !VIS_STOP.has(t) && !Q_STOP.has(t));
    if (ks.length && !/\b(instituciones|entidades)\b.*\bmas\b|\bmas\b.*\b(instituciones|entidades)\b/.test(qn)) {
      const kk = ks.map(stem), hits = [];
      DATA.cong.forEach(it => { if (cam && it.c.camara !== cam) return; (it.vi?.top_entidades || []).forEach(([e, c]) => { if (kk.every(k => words(e).some(w => w.startsWith(k)))) hits.push({ it, e, c }); }); });
      if (hits.length) {
        const by = {}; hits.forEach(h => { by[h.it.slug] = by[h.it.slug] || { it: h.it, v: 0, es: [] }; by[h.it.slug].v += h.c; by[h.it.slug].es.push(h.e); });
        const L = Object.values(by).sort((a, b) => b.v - a.v).slice(0, Math.max(n, 8));
        return A(`Congresistas que tienen a “${esc(ks.join(" "))}” entre las 8 instituciones que más los visitan (${fmt(Object.keys(by).length)} en total):`,
          rankList(L.map(o => ({ it: o.it, v: o.v, sub: esc(trunc(o.es.map(titleCase).join(" · "), 90)) })), fmt), ["vis"], ["¿Qué instituciones visitan más el Congreso?", "¿Qué congresista recibe más visitas?"]);
      }
    }
    if (/\b(instituciones|entidades|empresas|organizaciones|quienes visitan|quien visita)\b/.test(qn)) {
      const te = (V.top_entidades || []).slice(0, topN(qn, 15));
      return A(`El registro suma <b>${fmt(V.totales?.visitas)} visitas</b> desde el ${esc(fecha(V.meta?.desde))}, ${fmt(V.totales?.a_despachos)} a despachos congresales. Instituciones que más visitas registran:`,
        rankList(te.map(([e, c]) => ({ label: esc(titleCase(e)), v: c })), fmt) + `<p class="capb-mut">Se cuenta la entidad declarada por el visitante; una misma institución puede aparecer con nombres distintos (p. ej. MINSA y Ministerio de Salud).</p>`,
        ["vis"], ["¿Qué congresista recibe más visitas?", "¿Quién recibe visitas de Essalud?", "Ranking de visitas en el Senado"]);
    }
    return ranking(Object.assign({ key: "visitas" }, METRICS.visitas), cam, n, asc, qn);
  }

  /* ── asesores ── */
  function asesores(q, qn, cam, n) {
    const per = findPerson(q);
    const em = /\b(?:trabajaron|trabajo|laboraron|laboro|vienen|viene|provienen|proviene|pasaron|paso|estuvieron|estuvo)\s+(?:en|de|del|por)\s+(?:la |el |los |las )?(.+)$/.exec(qn);
    if (em && !per) {
      const ks = words(em[1]).filter(t => t.length >= 3 && !Q_STOP.has(t)).map(stem);
      if (!ks.length) return null;
      const L = [];
      DATA.cong.forEach(it => { if (cam && it.c.camara !== cam) return; it.ase.forEach(a => (a.historial || []).forEach(h => { if (ks.every(k => words(h.entidad + " " + (h.detalle || "")).some(w => w.startsWith(k)))) L.push({ it, a, h }); })); });
      const uniq = {}; L.forEach(x => { uniq[x.a.nombre + "|" + x.it.slug] = uniq[x.a.nombre + "|" + x.it.slug] || x; });
      const U = Object.values(uniq).sort((a, b) => (b.h.hasta || b.h.desde || "").localeCompare(a.h.hasta || a.h.desde || ""));
      if (!U.length) return A(`No encontré asesores de despachos congresales con registros en “${esc(em[1])}”.`, "", ["ase"], ["Asesores que trabajaron en el Ministerio de Salud", "Asesores que trabajaron en un gobierno regional"]);
      const k = Math.max(n, 12);
      return A(`<b>${fmt(U.length)} asesores</b> de despachos congresales registran trabajo previo en entidades que coinciden con “${esc(em[1])}”.`,
        `<ul class="capb-vl">${U.slice(0, k).map(({ it, a, h }) => `<li><div class="capb-vh"><b>${esc(nombreNat(titleCase(a.nombre)))}</b> <span class="capb-mut">· ${esc(a.cargo)} de</span> ${congLink(it)} ${congTag(it)}</div><div>${esc(h.entidad)}</div><div class="capb-mut">${esc(h.cargo || "")}${h.cargo ? " · " : ""}${esc(mesTxt(h.desde))}${h.hasta && h.hasta !== h.desde ? "–" + esc(mesTxt(h.hasta)) : ""} · ${esc(h.fuente)}</div></li>`).join("")}</ul>` +
        (U.length > k ? `<p class="capb-mut">Y ${fmt(U.length - k)} más.</p>` : "") + `<p class="capb-mut">Cruce por nombre completo, sin DNI: puede haber homónimos. Se excluyen los nombres marcados como ambiguos.</p>`,
        ["ase"], ["Asesores que trabajaron en Essalud", "Despachos más caros del Senado"]);
    }
    if (!per) return null;
    if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
    const it = per.best, d = it.d, as = it.ase;
    const eq = (d?.equipo || []).slice().sort((a, b) => b.total - a.total);
    const asBy = {}; as.forEach(a => { asBy[norm(a.nombre)] = a; });
    const seen = new Set();
    const rowP = (nombre, cargo, total, a) => {
      seen.add(norm(nombre));
      const hs = (a?.historial || []).slice(0, 3);
      return `<li><div class="capb-vh"><b>${esc(nombreNat(titleCase(nombre)))}</b> <span class="capb-mut">· ${esc(cargo || a?.cargo || "")}</span>${total != null ? ` <span class="capb-mut">· ${soles(total)}/mes</span>` : ""}</div>` +
        (hs.length ? `<ul class="capb-hist">${hs.map(h => `<li>${esc(h.entidad)} <span class="capb-mut">· ${esc(h.cargo || "")}${h.cargo ? " · " : ""}${esc(mesTxt(h.desde))}${h.hasta && h.hasta !== h.desde ? "–" + esc(mesTxt(h.hasta)) : ""} · ${esc(h.fuente)}</span></li>`).join("")}${(a.historial || []).length > 3 ? `<li class="capb-mut">y ${(a.historial.length - 3)} registros más</li>` : ""}</ul>` : "") + `</li>`;
    };
    let lst = eq.map(e => rowP(e.nombre, e.cargo, e.total, asBy[norm(e.nombre)])).join("");
    as.forEach(a => { if (!seen.has(norm(a.nombre))) lst += rowP(a.nombre, a.cargo, null, a); });
    const conH = eq.filter(e => asBy[norm(e.nombre)]).length + as.filter(a => !eq.some(e => norm(e.nombre) === norm(a.nombre))).length;
    if (!lst) return nada(`No encontramos el equipo del despacho de ${congLink(it)} en la planilla publicada.`, ["mov"]);
    return A(`El despacho de ${congLink(it)} ${congTag(it)} tiene ${d ? `<b>${fmt(d.personal)} personas</b> en planilla (${soles(d.masa)} al mes)` : "personal en planilla"}; ${conH ? `<b>${fmt(conH)}</b> tienen trayectoria registrada en otras entidades del Estado` : "no encontramos trayectoria previa de sus integrantes en otras entidades"}.`,
      `<ul class="capb-vl">${lst}</ul><p class="capb-mut">Trayectoria: cruce por nombre completo (sin DNI) con planillas PTE, declaraciones juradas, El Peruano y OCDS; pueden existir homónimos.</p>`,
      ["mov", "ase"], [`¿Cuánto gasta el despacho de ${fu(it)}?`, `Resumen de ${fu(it)}`, "Asesores que trabajaron en Essalud"], it);
  }

  /* ── representación y viajes ── */
  function representacion(q, qn, cam, n) {
    const P = DATA.R.pf;
    if (!P) return nada("No tengo los perfiles cargados.", []);
    const per = findPerson(q);
    const viaje = /viaj/.test(qn);
    if (per) {
      if (per.all.length > 1 && per.score < 5) return ambiguous(per, q);
      const it = per.best, pf = it.pf;
      if (!pf) return nada(`No hay perfil publicado para ${congLink(it)}.`, ["pf"]);
      const rp = pf.representacion || [], vj = pf.viajes || [];
      const link = (u, t) => safeUrl(u) ? `<a class="capb-l" href="${esc(u)}" target="_blank" rel="noopener">${t}</a>` : t;
      return A(`${congLink(it)} ${congTag(it)} tiene <b>${fmt(rp.length)} informe${rp.length === 1 ? "" : "s"} de semana de representación</b> y <b>${fmt(vj.length)} informe${vj.length === 1 ? "" : "s"} de viaje</b> publicados.`,
        (rp.length ? h5("Semana de representación") + table(["Fecha", "Lugar", "Informe"], rp.map(r => [esc(fecha(r.fecha)), esc(r.lugar || "—"), link(r.pdf, "PDF")])) : `<p class="capb-mut">Sin informes de representación publicados.</p>`) +
        (vj.length ? h5("Viajes") + table(["Fecha", "Detalle", "Informe"], vj.map(r => [esc(fecha(r.fecha)), esc(r.detalle || "—"), link(r.pdf, "PDF")])) : `<p class="capb-mut">Sin informes de viaje publicados.</p>`),
        ["pf"], [`Resumen de ${fu(it)}`, "Ranking de informes de viaje", "Ranking de semana de representación"], it);
    }
    if (viaje && /\b(ranking|top|mas|menos|quien|quienes)\b/.test(qn)) return ranking(Object.assign({ key: "viajes" }, METRICS.viajes), cam, n, false, qn);
    if (viaje) {
      const L = DATA.cong.filter(it => (!cam || it.c.camara === cam) && (it.pf?.viajes || []).length);
      const all = [];
      L.forEach(it => it.pf.viajes.forEach(v => all.push({ it, v })));
      all.sort((a, b) => (b.v.fecha || "").localeCompare(a.v.fecha || ""));
      return A(`Hay <b>${fmt(all.length)} informes de viaje</b> publicados ${cam ? (cam === "S" ? "en el Senado" : "en Diputados") : "en las webs de ambas cámaras"}, de ${fmt(L.length)} congresistas.`,
        `<ul class="capb-vl">${all.slice(0, 15).map(({ it, v }) => `<li><div class="capb-vh">${avatar(it, 22)} ${congLink(it)} ${congTag(it)} <span class="capb-mut">· ${esc(fecha(v.fecha))}</span></div><div class="capb-mut">${esc(v.detalle || "")}${safeUrl(v.pdf) ? ` · <a class="capb-l" href="${esc(v.pdf)}" target="_blank" rel="noopener">PDF</a>` : ""}</div></li>`).join("")}</ul>`,
        ["pf"], ["Ranking de semana de representación", "Semana de representación de Isla Rojas"]);
    }
    const tot = DATA.cong.filter(it => !cam || it.c.camara === cam).reduce((s, it) => s + (it.pf?.representacion || []).length, 0);
    const r = ranking(Object.assign({ key: "representacion" }, METRICS.representacion), cam, n, false, qn);
    r.text = `Hay <b>${fmt(tot)} informes de semana de representación</b> publicados ${cam ? (cam === "S" ? "en el Senado" : "en Diputados") : "en ambas cámaras"}. ` + r.text;
    return r;
  }

  function helpCard() {
    return A("Respondo con los datos publicados en este sitio (sin inteligencia artificial: reglas sobre los JSON oficiales). Puedes preguntar por congresistas, votaciones, comisiones, visitas, despachos y asesores, proyectos, contratos y presupuesto.", welcomeGroups(), [], []);
  }

  /* ───────────── búsqueda en vivo (mientras escribes) ───────────── */
  function renderSearch(res, q) {
    if (!res) return "";
    const g = [];
    if (res.cong.length) g.push(`<h5 class="capb-h">Congresistas</h5><ul class="capb-ul">` + res.cong.map(it =>
      `<li><a class="capb-row" href="${congHref(it)}">${avatar(it, 30)}<span><b>${esc(nombreNat(it.c.nombre))}</b> ${congTag(it)}<br><span class="capb-mut">${esc(CAMC[it.c.camara])} · ${esc(it.c.distrito)} · ${fmt(it.c.principal)} proyectos</span></span></a></li>`).join("") + "</ul>");
    if (res.proy.length) g.push(`<h5 class="capb-h">Proyectos</h5><ul class="capb-ul">` + res.proy.map(projRow).join("") + "</ul>");
    if (res.prov.length) g.push(`<h5 class="capb-h">Proveedores</h5><ul class="capb-ul">` + res.prov.map(it =>
      `<li><button type="button" class="capb-pv" data-ruc="${esc(it.ruc)}" aria-expanded="false"><b>${esc(it.nombre)}</b>${it.s?.vigente ? ' <span class="capb-tag capb-red">sanción vigente</span>' : it.s ? ' <span class="capb-tag">sancionado</span>' : ""}<br><span class="capb-mut">RUC ${esc(it.ruc)} · ${soles(it.monto)} · ${fmt(it.procesos)} procesos</span></button><div class="capb-det" hidden></div></li>`).join("") + "</ul>");
    if (res.com.length) g.push(`<h5 class="capb-h">Comisiones</h5><ul class="capb-ul">` + res.com.map(it =>
      `<li><button type="button" class="capb-row" data-q="${esc("Miembros de la " + (/^comisi/i.test(it.nombre) ? it.nombre : "Comisión de " + it.nombre) + (it.cam === "S" ? " del Senado" : it.cam === "D" ? " de Diputados" : ""))}"><span><b>${esc(it.nombre)}</b><br><span class="capb-mut">${esc(CAMC[it.cam])} · ${fmt(it.miembros)} integrantes${it.proyectos != null ? " · " + fmt(it.proyectos) + " proyectos derivados" : ""}</span></span></button></li>`).join("") + "</ul>");
    if (!g.length) return `<p class="capb-mut">Sin resultados para “${esc(q)}”. Pulsa Enter para preguntar.</p>`;
    return g.join("");
  }

  /* ───────────── UI ───────────── */
  const GROUPS = [
    ["Congresistas", "👤", ["Resumen de Zunini", "¿En qué comisiones está Columbus?", "Compara Zunini con Columbus", "Top 10 diputados con más proyectos", "¿Quién falta más al Pleno en el Senado?"]],
    ["Votaciones", "🗳️", ["¿Quiénes votaron en contra del reglamento del Senado?", "¿Cómo votó Aguinaga en estado de emergencia?", "Última votación de Diputados", "¿Quién vota más contra su bancada?"]],
    ["Proyectos y comisiones", "📄", ["Proyectos de Fuerza Popular sobre salud", "Proyectos con riesgo fiscal", "¿Quién preside la comisión de Salud?", "Último proyecto de Zunini"]],
    ["Despachos y visitas", "🏛️", ["¿Qué congresista recibe más visitas?", "¿Qué instituciones visitan más el Congreso?", "Asesores de Columbus", "Despachos más caros del Senado"]],
    ["Contratos", "🧾", ["Top 10 proveedores del Congreso", "Proveedores sancionados", "¿Cuánto contrató el Congreso con Entel?"]],
    ["Presupuesto", "💰", ["Presupuesto del Congreso 2026", "¿Cuánto cuesta el Congreso?", "¿Cuántos trabajadores tiene el Congreso?"]],
  ];
  const chips = list => `<div class="capb-chips">${list.map(t => `<button type="button" class="capb-chip" data-q="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
  const welcomeGroups = () => `<div class="capb-groups">${GROUPS.map(([t, ic, L]) => `<section class="capb-grp"><h5 class="capb-h"><span aria-hidden="true">${ic}</span> ${esc(t)}</h5>${chips(L)}</section>`).join("")}</div>`;

  const CSS = `
  .capb-fab{position:fixed;right:16px;bottom:16px;z-index:45;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border,#23262e);background:var(--accent,#e23744);color:#fff;font:600 14px/1 Inter,system-ui,sans-serif;padding:12px 16px;border-radius:999px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}
  .capb-fab:hover{filter:brightness(1.07)} .capb-fab kbd{font:600 11px/1 'Geist Mono',monospace;background:rgba(255,255,255,.2);border-radius:5px;padding:3px 6px}
  .capb-ov{position:fixed;inset:0;z-index:70;background:rgba(5,6,8,.5);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px 16px}
  .capb-ov[hidden]{display:none}
  .capb-box{width:100%;max-width:780px;height:90vh;max-height:900px;display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--text,#16181d);border:1px solid var(--border,#e6e8ec);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden;font-family:Inter,system-ui,sans-serif}
  .capb-top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)}
  .capb-logo{flex:none;width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,var(--accent,#e23744),#b3121d);color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px}
  .capb-tt{flex:1;min-width:0}.capb-tt b{display:block;font-size:14.5px;letter-spacing:-.01em}.capb-tt small{display:block;color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .capb-ib{flex:none;border:1px solid var(--border);background:var(--panel-2,var(--panel));color:var(--text);border-radius:9px;padding:7px 10px;font:600 12.5px/1 inherit;font-family:inherit;cursor:pointer}
  .capb-ib:hover{border-color:var(--muted)}
  .capb-log{position:relative;flex:1;overflow:auto;overflow-x:hidden;padding:16px 14px 8px;font-size:14px;line-height:1.5;overscroll-behavior:contain;scroll-behavior:smooth}
  .capb-msg{display:flex;gap:10px;margin:0 0 14px;min-width:0}
  .capb-user{justify-content:flex-end}
  .capb-user p{margin:0;max-width:85%;background:var(--accent-2,#3b82f6);color:#fff;padding:9px 13px;border-radius:16px 16px 4px 16px;font-weight:500;overflow-wrap:anywhere}
  .capb-bot>.capb-av{margin-top:2px}
  .capb-card{flex:1;min-width:0;border:1px solid var(--border);border-radius:4px 16px 16px 16px;padding:12px 14px;background:var(--panel-2,transparent)}
  .capb-card>.capb-s{margin:0 0 8px;overflow-wrap:anywhere}
  .capb-av{flex:none;width:32px;height:32px;border-radius:50%;overflow:hidden;display:inline-grid;place-items:center;background:color-mix(in srgb,var(--bc,var(--accent-2)) 18%,var(--panel));color:var(--bc,var(--accent-2));font-weight:800;font-size:11px;box-shadow:0 0 0 2px color-mix(in srgb,var(--bc,var(--border)) 55%,transparent);vertical-align:middle}
  .capb-av img{width:100%;height:100%;object-fit:cover;display:block}
  .capb-av.capb-bot-av{background:linear-gradient(135deg,var(--accent,#e23744),#b3121d);color:#fff;box-shadow:none}
  .capb-who{display:flex;gap:12px;align-items:center;margin:0 0 10px;padding-bottom:10px;border-bottom:1px dashed var(--border)}
  .capb-who>div{min-width:0}
  .capb-wn{font-weight:800;font-size:15.5px;color:var(--text);text-decoration:none;letter-spacing:-.01em}.capb-wn:hover{text-decoration:underline}
  .capb-wm{display:flex;flex-wrap:wrap;gap:6px;align-items:center;color:var(--muted);font-size:12.5px;margin-top:2px}
  .capb-bc{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.02em;padding:1px 7px;border-radius:999px;color:var(--bc,var(--muted));background:color-mix(in srgb,var(--bc,var(--muted)) 15%,transparent);border:1px solid color-mix(in srgb,var(--bc,var(--muted)) 45%,transparent);vertical-align:1px;white-space:nowrap}
  .capb-h{margin:14px 0 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700}
  .capb-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:8px 0 4px}
  .capb-tile{border:1px solid var(--border);background:var(--panel);border-radius:12px;padding:9px 11px;min-width:0}
  .capb-tile b{display:block;font-size:18px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  .capb-tile span{display:block;font-size:11.5px;color:var(--muted);font-weight:600}
  .capb-tile small{display:block;font-size:11px;color:var(--muted);margin-top:2px;line-height:1.3}
  .capb-tile.grn b{color:var(--green,#22c55e)} .capb-tile.red b{color:var(--accent,#e23744)} .capb-tile.amb b{color:var(--amber,#f59e0b)}
  .capb-bar{display:block;height:6px;border-radius:99px;background:color-mix(in srgb,var(--muted) 18%,transparent);overflow:hidden;margin-top:4px}
  .capb-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent-2,#3b82f6),var(--purple,#a855f7))}
  .capb-bar.mut i{background:var(--muted)}
  .capb-cmp{display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;font-size:12.5px;margin-top:8px}.capb-cmp .capb-bar{margin:0}
  .capb-rank{list-style:none;margin:4px 0 0;padding:0;display:grid;gap:2px}
  .capb-rank li{display:grid;grid-template-columns:22px auto minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid color-mix(in srgb,var(--border) 70%,transparent)}
  .capb-rank li:last-child{border-bottom:0}
  .capb-rank li.na{grid-template-columns:22px minmax(0,1fr) auto}
  .capb-rk{font:700 11.5px/1 'Geist Mono',monospace;color:var(--muted);text-align:right}
  .capb-rn{min-width:0;overflow-wrap:anywhere}.capb-rn small{display:block;color:var(--muted);font-size:11.5px}
  .capb-rv{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:13px}
  .capb-cols{display:flex;align-items:flex-end;gap:4px;height:96px;padding:4px 0 0;margin:2px 0 4px}
  .capb-col{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px}
  .capb-col i{display:block;width:100%;max-width:38px;border-radius:5px 5px 2px 2px;background:color-mix(in srgb,var(--accent-2,#3b82f6) 55%,transparent)}
  .capb-col.on i{background:var(--accent,#e23744)}
  .capb-col span{font-size:10px;color:var(--muted);white-space:nowrap}
  .capb-stack{display:flex;height:12px;border-radius:99px;overflow:hidden;background:color-mix(in srgb,var(--muted) 18%,transparent);margin:8px 0 6px}
  .capb-stack i.si,.capb-leg i.si{background:var(--green,#22c55e)} .capb-stack i.no,.capb-leg i.no{background:var(--accent,#e23744)} .capb-stack i.ab,.capb-leg i.ab{background:var(--amber,#f59e0b)}
  .capb-leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px}.capb-leg i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:0}
  .capb-v{display:inline-block;font-size:11px;font-weight:800;padding:1px 7px;border-radius:999px;white-space:nowrap;border:1px solid}
  .capb-v-si{color:var(--green,#22c55e);border-color:color-mix(in srgb,var(--green,#22c55e) 50%,transparent);background:color-mix(in srgb,var(--green,#22c55e) 12%,transparent)}
  .capb-v-no{color:var(--accent,#e23744);border-color:color-mix(in srgb,var(--accent,#e23744) 50%,transparent);background:color-mix(in srgb,var(--accent,#e23744) 12%,transparent)}
  .capb-v-ab{color:var(--amber,#f59e0b);border-color:color-mix(in srgb,var(--amber,#f59e0b) 50%,transparent);background:color-mix(in srgb,var(--amber,#f59e0b) 12%,transparent)}
  .capb-v-au,.capb-v-li,.capb-v-ot{color:var(--muted);border-color:var(--border)}
  .capb-asunto{margin:4px 0 2px;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}
  .capb-names{margin:0 0 4px;font-size:13px;line-height:1.75;overflow-wrap:anywhere}
  .capb-vl{list-style:none;margin:0;padding:0;display:grid;gap:8px}
  .capb-vl>li{border-left:3px solid var(--border);padding:2px 0 2px 10px;overflow-wrap:anywhere;min-width:0}
  .capb-vh{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;font-size:12.5px}
  .capb-vt{font-size:13px;font-weight:500!important;color:var(--text)!important}
  .capb-hist{margin:3px 0 0;padding-left:16px;font-size:12.5px}
  .capb-cl{list-style:none;margin:0;padding:0;display:grid;gap:5px;font-size:13px}
  .capb-cl li{overflow-wrap:anywhere;line-height:1.55}.capb-cl li>.capb-role,.capb-cl li>.capb-av{margin-right:4px}
  .capb-role{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:6px;border:1px solid var(--border);color:var(--muted);white-space:nowrap}
  .capb-role.r0{color:var(--purple,#a855f7);border-color:color-mix(in srgb,var(--purple,#a855f7) 50%,transparent);background:color-mix(in srgb,var(--purple,#a855f7) 12%,transparent)}
  .capb-role.r1,.capb-role.r2{color:var(--accent-2,#3b82f6);border-color:color-mix(in srgb,var(--accent-2,#3b82f6) 45%,transparent)}
  .capb-team{list-style:none;margin:0;padding:0;display:grid;gap:6px}
  .capb-team li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px}
  .capb-team small{display:block;color:var(--muted);font-size:11.5px}.capb-team span{font-variant-numeric:tabular-nums;white-space:nowrap}
  .capb-bul{margin:8px 0 0;padding-left:18px;font-size:12.5px;color:var(--muted)}
  .capb-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .capb-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:9px;padding:7px 11px;font-size:12.5px;font-weight:600;text-decoration:none}
  .capb-btn:hover{border-color:var(--accent-2);color:var(--accent-2)}
  .capb-cmpt th,.capb-cmpt td{text-align:center}.capb-cmpt tbody th{text-align:left}
  .capb-cmph{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:12px;text-transform:none;letter-spacing:0;color:var(--text)}
  .capb-cmph small{color:var(--muted);font-weight:500}
  .capb-best{color:var(--green,#22c55e);font-weight:800}
  .capb-fu{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .capb-src{margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);font-size:11px;color:var(--muted);line-height:1.4}
  .capb-src b{color:var(--text);font-weight:600}
  .capb-ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
  .capb-row,.capb-pj,.capb-pv{display:flex;gap:9px;align-items:center;width:100%;text-align:left;background:none;border:1px solid transparent;border-radius:9px;padding:7px 9px;color:var(--text);text-decoration:none;font:inherit;cursor:pointer;overflow-wrap:anywhere;min-width:0}
  .capb-pj,.capb-pv{display:block}
  .capb-row>span{min-width:0}
  .capb-row:hover,.capb-pj:hover,.capb-pv:hover,.capb-row:focus-visible,.capb-pj:focus-visible,.capb-pv:focus-visible{background:var(--panel,rgba(127,127,127,.08));border-color:var(--border)}
  .capb-det{margin:4px 0 8px 9px;padding:10px 12px;border-left:3px solid var(--accent-2);background:var(--panel,transparent);border-radius:0 9px 9px 0;overflow-wrap:anywhere}
  .capb-det.capb-open{margin-left:0}
  .capb-mut{color:var(--muted);font-size:12.5px}
  .capb-code{font-family:'Geist Mono',monospace;font-size:12px;color:var(--accent-2)}
  .capb-tag{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:5px;border:1px solid var(--border);color:var(--muted);vertical-align:1px;white-space:nowrap}
  .capb-amb{color:var(--amber,#f59e0b);border-color:color-mix(in srgb,var(--amber,#f59e0b) 50%,transparent)}
  .capb-red{color:var(--accent,#e23744)!important;border-color:var(--accent,#e23744)}
  .capb-warn{color:var(--accent);font-weight:700;margin:8px 0 4px}
  .capb-l,.capb-lk{color:var(--accent-2);text-decoration:none;font-weight:600}
  .capb-lk{background:none;border:0;padding:0;font:inherit;font-weight:600;cursor:pointer;text-align:left}
  .capb-l:hover,.capb-lk:hover{text-decoration:underline}
  .capb-tw{max-width:100%;overflow-x:auto}
  .capb-t{width:100%;border-collapse:collapse;font-size:13px}
  .capb-t th,.capb-t td{padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;overflow-wrap:break-word}
  .capb-t thead th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700}
  .capb-t tbody th{color:var(--muted);font-weight:600}
  .capb-t td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .capb-cmpt td.n{text-align:center}
  .capb-dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0 0 6px;font-size:13px}
  .capb-dl dt{color:var(--muted)} .capb-dl dd{margin:0;overflow-wrap:anywhere;min-width:0}
  .capb-ttl{margin:6px 0 0;font-size:13px}
  .capb-chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 2px}
  .capb-chip{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:999px;padding:6px 11px;font-size:12.5px;font-weight:500;line-height:1.25;font-family:inherit;cursor:pointer;text-align:left;max-width:100%;overflow-wrap:anywhere}
  .capb-chip:hover,.capb-chip:focus-visible{border-color:var(--accent-2);color:var(--accent-2)}
  .capb-fu .capb-chip{background:color-mix(in srgb,var(--accent-2,#3b82f6) 8%,var(--panel));border-color:color-mix(in srgb,var(--accent-2,#3b82f6) 30%,var(--border))}
  .capb-fu .capb-chip::before{content:"↳ ";color:var(--accent-2)}
  .capb-hello{text-align:center;padding:8px 6px 4px}
  .capb-hello .capb-logo{width:46px;height:46px;border-radius:14px;margin:0 auto 10px;font-size:18px}
  .capb-hello h3{margin:0 0 4px;font-size:19px;letter-spacing:-.02em}
  .capb-hello p{margin:0 auto;color:var(--muted);font-size:13px;max-width:520px}
  .capb-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:14px;text-align:left}
  .capb-grp{border:1px solid var(--border);border-radius:14px;padding:4px 12px 10px;background:var(--panel-2,transparent)}
  .capb-typing .capb-card{flex:0 0 auto;padding:12px 16px}
  .capb-dots{display:inline-flex;gap:4px}.capb-dots i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:capbDot 1s infinite ease-in-out}
  .capb-dots i:nth-child(2){animation-delay:.15s}.capb-dots i:nth-child(3){animation-delay:.3s}
  @keyframes capbDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
  @media (prefers-reduced-motion:reduce){.capb-dots i{animation:none;opacity:.6}.capb-log{scroll-behavior:auto}}
  .capb-live{border-top:1px solid var(--border);max-height:42%;overflow:auto;overflow-x:hidden;padding:4px 12px 8px;background:var(--panel);font-size:13.5px}
  .capb-live[hidden]{display:none}
  .capb-form{display:flex;gap:8px;align-items:center;padding:10px 12px;border-top:1px solid var(--border);background:var(--panel)}
  .capb-in{flex:1;min-width:0;background:var(--panel-2,var(--panel));color:var(--text);border:1px solid var(--border);border-radius:12px;padding:12px 13px;font-size:16px;font-weight:500;line-height:1.2;font-family:inherit;outline:none}
  .capb-in:focus{border-color:var(--accent-2,#3b82f6);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent-2,#3b82f6) 20%,transparent)}
  .capb-go{flex:none;border:0;background:var(--accent-2,#3b82f6);color:#fff;border-radius:12px;padding:12px 15px;font-size:14px;font-weight:700;line-height:1;font-family:inherit;cursor:pointer}
  .capb-go:hover{filter:brightness(1.08)}
  .capb-kb{font-size:11px;color:var(--muted);padding:0 14px 8px;background:var(--panel)}
  .capb-kb kbd{font:600 10.5px/1 'Geist Mono',monospace;border:1px solid var(--border);border-radius:4px;padding:2px 5px}
  .capb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  @media (max-width:520px){
    .capb-ov{padding:0}
    .capb-box{max-width:none;max-height:none;height:100%;height:100dvh;border-radius:0;border:0}
    .capb-fab .capb-k{display:none}
    .capb-log{padding:12px 10px 6px}
    .capb-card{padding:10px 11px}
    .capb-bot>.capb-av{display:none}
    .capb-user p{max-width:92%}
    .capb-t{font-size:12.5px}
    .capb-t th,.capb-t td{padding:5px 6px}
    .capb-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
    .capb-tile b{font-size:16px}
    .capb-groups{grid-template-columns:1fr}
    .capb-kb{display:none}
    .capb-ib.capb-clear span{display:none}
  }`;

  let ov, box, inp, logEl, liveEl, lastFocus, timer, histIdx = -1, booted = false, busy = Promise.resolve();
  const HKEY = "cap-bot-chat", HMAX = 12;
  function hGet() { try { const v = JSON.parse(sessionStorage.getItem(HKEY) || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string").slice(-HMAX) : []; } catch (e) { return []; } }
  function hSet(L) { try { sessionStorage.setItem(HKEY, JSON.stringify(L.slice(-HMAX))); } catch (e) { /* sin almacenamiento */ } }
  function hPush(q) { const L = hGet(); L.push(q); hSet(L); }

  function botAv() { return `<span class="capb-av capb-bot-av" aria-hidden="true">CA</span>`; }
  function renderAnswer(a, q) {
    if (!a) {
      const res = search(q);
      return `<article class="capb-msg capb-bot">${botAv()}<div class="capb-card"><p class="capb-s">No entendí del todo la pregunta. Estos son los resultados de búsqueda para “${esc(q)}”; también puedes probar con:</p>${chips(["Resumen de Zunini", "Proyectos sobre agua", "¿Quién preside la comisión de Salud?", "Presupuesto del Congreso 2026"])}${renderSearch(res, q)}${src(["bi"])}</div></article>`;
    }
    const who = a.who ? whoHead(a.who) : "";
    return `<article class="capb-msg capb-bot">${a.who ? avatar(a.who, 32) : botAv()}<div class="capb-card">${who}<p class="capb-s">${a.text}</p>${a.body}` +
      (a.follow && a.follow.length ? `<div class="capb-fu" aria-label="Preguntas sugeridas">${a.follow.slice(0, 4).map(t => `<button type="button" class="capb-chip" data-q="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : "") +
      src(a.src) + `</div></article>`;
  }
  function compute(q) {
    let a = null;
    try { a = answer(q); } catch (e) { console.error("bot:", e); a = null; }
    return a;
  }
  function welcome() {
    const g = DATA ? `<small>Datos al ${esc(fecha(DATA.R.bi?.meta?.generado || DATA.R.pl?.meta?.generado || ""))}</small>` : "";
    return `<div class="capb-hello"><div class="capb-logo" aria-hidden="true">CA</div><h3>¿Qué quieres saber del Congreso?</h3><p>Pregunta por congresistas, votaciones, comisiones, visitas, despachos, contratos o presupuesto. Respondo solo con datos oficiales publicados en este sitio. ${g}</p>${welcomeGroups()}</div>`;
  }
  function scrollToLast() {
    const L = logEl.querySelectorAll(".capb-user");
    const el = L[L.length - 1];
    if (el) logEl.scrollTop = el.offsetTop - 8; else logEl.scrollTop = logEl.scrollHeight;
  }
  function boot() {
    if (booted) return;
    booted = true;
    const H = hGet();
    if (!H.length) { logEl.innerHTML = welcome(); return; }
    logEl.innerHTML = H.map(q => `<div class="capb-msg capb-user"><p>${esc(q)}</p></div>` + renderAnswer(compute(q), q)).join("");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function build() {
    const st = document.createElement("style"); st.id = "capb-style"; st.textContent = CSS; document.head.appendChild(st);
    const fab = document.createElement("button");
    fab.type = "button"; fab.className = "capb-fab"; fab.id = "capb-fab";
    fab.setAttribute("aria-label", "Buscar o preguntar (atajo: /)");
    fab.setAttribute("aria-haspopup", "dialog");
    fab.innerHTML = `<span aria-hidden="true">🔎</span> Buscar / Preguntar <kbd class="capb-k">/</kbd>`;
    fab.addEventListener("click", () => open());
    document.body.appendChild(fab);
    ov = document.createElement("div"); ov.className = "capb-ov"; ov.hidden = true;
    ov.innerHTML = `<div class="capb-box" role="dialog" aria-modal="true" aria-labelledby="capb-title" aria-describedby="capb-desc">
      <div class="capb-top"><div class="capb-logo" aria-hidden="true">CA</div><div class="capb-tt"><b id="capb-title">Pregúntale al Congreso Abierto</b><small id="capb-desc">Respuestas con datos oficiales · sin IA · sin registro</small></div>
      <button class="capb-ib capb-clear" type="button" aria-label="Nueva conversación">↺ <span>Nueva</span></button><button class="capb-ib capb-x" type="button" aria-label="Cerrar">✕</button></div>
      <div class="capb-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversación" tabindex="-1"></div>
      <div class="capb-live" hidden aria-label="Resultados de búsqueda"></div>
      <form class="capb-form" autocomplete="off" role="search"><label class="capb-sr" for="capb-in">Escribe tu pregunta o búsqueda</label><input id="capb-in" class="capb-in" type="search" enterkeyhint="send" placeholder="Ej.: ¿cómo votó Zunini en…? · resumen de Columbus" aria-describedby="capb-kbh">
      <button class="capb-go" type="submit">Preguntar</button></form>
      <div class="capb-kb" id="capb-kbh"><kbd>Enter</kbd> preguntar · <kbd>↑</kbd> última pregunta · <kbd>Esc</kbd> cerrar</div></div>`;
    document.body.appendChild(ov);
    box = ov.querySelector(".capb-box"); inp = ov.querySelector(".capb-in"); logEl = ov.querySelector(".capb-log"); liveEl = ov.querySelector(".capb-live");
    ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
    ov.querySelector(".capb-x").addEventListener("click", close);
    ov.querySelector(".capb-clear").addEventListener("click", () => { hSet([]); histIdx = -1; logEl.innerHTML = DATA ? welcome() : ""; inp.value = ""; liveEl.hidden = true; inp.focus(); });
    ov.querySelector("form").addEventListener("submit", e => { e.preventDefault(); ask(inp.value); });
    inp.addEventListener("input", () => { histIdx = -1; clearTimeout(timer); timer = setTimeout(live, 140); });
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const H = hGet();
        if (!H.length || (inp.value && histIdx === -1 && e.key === "ArrowUp" && inp.selectionStart !== 0)) return;
        e.preventDefault();
        if (e.key === "ArrowUp") histIdx = histIdx === -1 ? H.length - 1 : Math.max(0, histIdx - 1);
        else { if (histIdx === -1) return; histIdx++; if (histIdx >= H.length) { histIdx = -1; inp.value = ""; liveEl.hidden = true; return; } }
        inp.value = H[histIdx]; liveEl.hidden = true;
      }
    });
    box.addEventListener("click", onBodyClick);
    box.addEventListener("error", e => { const t = e.target; if (t && t.classList && t.classList.contains("capb-img")) { const p = t.parentNode; p.classList.add("capb-av-i"); p.textContent = t.getAttribute("data-ini") || ""; } }, true);
    box.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); if (!liveEl.hidden && inp.value) { liveEl.hidden = true; return; } close(); }
      if (e.key === "Tab") { // trampa de foco
        const f = [...box.querySelectorAll("a[href],button:not([disabled]),input,[tabindex]:not([tabindex='-1'])")].filter(x => x.offsetParent !== null || x === inp);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  function open(prefill) {
    if (!ov) return;
    if (ov.hidden) lastFocus = document.activeElement;
    ov.hidden = false;
    document.documentElement.style.overflow = "hidden";
    if (typeof prefill === "string") inp.value = prefill;
    inp.focus(); inp.select();
    if (!DATA) logEl.innerHTML = `<div class="capb-hello"><p>Cargando datos…</p></div>`;
    load().then(() => { boot(); if (inp.value.trim()) live(); }).catch(() => { logEl.innerHTML = `<p class="capb-mut">No se pudieron cargar los datos.</p>`; });
  }
  function close() {
    if (!ov || ov.hidden) return;
    ov.hidden = true;
    document.documentElement.style.overflow = "";
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* noop */ }
  }
  function live() {
    if (!DATA) return;
    const q = inp.value.trim();
    if (!q || q.length < 2) { liveEl.hidden = true; liveEl.innerHTML = ""; return; }
    const res = search(q, 3);
    const nres = res ? res.cong.length + res.proy.length + res.prov.length + res.com.length : 0;
    if (!nres) { liveEl.hidden = true; return; }
    liveEl.innerHTML = renderSearch(res, q);
    liveEl.hidden = false;
  }
  function ask(q) {
    q = (q || "").trim();
    clearTimeout(timer);
    if (!q) return Promise.resolve();
    inp.value = ""; histIdx = -1;
    liveEl.hidden = true; liveEl.innerHTML = "";
    busy = busy.then(() => load()).then(() => {
      boot();
      const hello = logEl.querySelector(".capb-hello");
      if (hello) hello.remove();
      logEl.insertAdjacentHTML("beforeend", `<div class="capb-msg capb-user"><p>${esc(q)}</p></div>`);
      logEl.insertAdjacentHTML("beforeend", `<div class="capb-msg capb-bot capb-typing" aria-hidden="true">${botAv()}<div class="capb-card"><span class="capb-dots"><i></i><i></i><i></i></span></div></div>`);
      scrollToLast();
      const a = compute(q);
      hPush(q);
      return new Promise(res => setTimeout(() => {
        const t = logEl.querySelector(".capb-typing"); if (t) t.remove();
        logEl.insertAdjacentHTML("beforeend", renderAnswer(a, q));
        // poda: conserva las últimas HMAX preguntas también en pantalla
        const us = logEl.querySelectorAll(".capb-user");
        if (us.length > HMAX) { let el = logEl.firstElementChild, k = us.length - HMAX; while (el && k > 0) { const nx = el.nextElementSibling; if (el.classList.contains("capb-user")) k--; el.remove(); el = nx; while (el && !el.classList.contains("capb-user")) { const n2 = el.nextElementSibling; el.remove(); el = n2; } } }
        scrollToLast();
        res();
      }, 260));
    });
    return busy;
  }
  function onBodyClick(e) {
    const chip = e.target.closest("[data-q]");
    if (chip && box.contains(chip)) { e.preventDefault(); ask(chip.getAttribute("data-q")); if (window.matchMedia && matchMedia("(pointer:fine)").matches) inp.focus(); return; }
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
      if (it) ask(`¿Cuánto contrató el Congreso con RUC ${it.ruc}?`);
      return;
    }
    // enlaces internos a la portada: cerrar el diálogo para ver la vista
    const a = e.target.closest("a[href^='index.html#']");
    if (a && /(^|\/)(index\.html)?$/.test(location.pathname)) { e.preventDefault(); close(); location.hash = a.getAttribute("href").replace(/^index\.html/, ""); }
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
  window.capBot = {
    open, close, ask, load, search: q => search(q),
    answerText: q => load().then(() => { const a = compute(q); return a ? (a.text + " " + a.body) : null; }),
  };
})();
