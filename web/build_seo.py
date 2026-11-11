"""Páginas estáticas para buscadores y bots de IA (el tablero principal se arma con JavaScript
y un crawler casi no ve contenido).

Genera, a partir de los JSON ya publicados:
  web/congresistas/index.html        índice de diputados y senadores con enlaces
  web/congresistas/<slug>.html       ficha por congresista: proyectos, asistencia, votos, despacho
  web/bancadas.html                  producción por bancada (2026–31 y 2021–26)
  web/proveedores.html               a quién le compra el Congreso + sanciones del Tribunal
  web/sitemap.xml · web/llms.txt · web/robots.txt

Corre en GitHub Actions antes de publicar (no se versiona: ver .gitignore).

    python web/build_seo.py
"""
from __future__ import annotations

import html
import json
import os
import re
import unicodedata
from datetime import date

WEB = os.path.dirname(os.path.abspath(__file__))
BASE = "https://unimauro.github.io/congreso-abierto-peru/"
CAMARA = {"D": "Cámara de Diputados", "S": "Senado", "C": "Congreso (bicameral)"}
CARGO = {"D": "Diputado(a)", "S": "Senador(a)"}


def cargar(nombre: str):
    try:
        return json.load(open(os.path.join(WEB, nombre), encoding="utf-8"))
    except FileNotFoundError:
        return None


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def e(x) -> str:
    return html.escape(str(x if x is not None else ""))


def soles(x) -> str:
    return f"S/ {x:,.0f}" if x is not None else "—"


def nombre_natural(n: str) -> str:
    """'Pérez Gómez, Ana María' → 'Ana María Pérez Gómez'."""
    ap, _, nom = n.partition(",")
    return f"{nom.strip()} {ap.strip()}".strip()


CSS = """
:root{--bg:#f6f7f9;--panel:#fff;--border:#e6e8ec;--text:#16181d;--muted:#5b626f;--accent:#e23744;--accent-2:#3b82f6;--green:#16a34a;--amber:#d97706}
@media (prefers-color-scheme:dark){:root{--bg:#0a0b0d;--panel:#121317;--border:#23262e;--text:#e7e9ee;--muted:#9aa1ad}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:20px 16px 48px}a{color:var(--accent-2)}
header.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
header.top a.home{font-weight:800;color:var(--text);text-decoration:none}
h1{font-size:26px;margin:8px 0 4px;line-height:1.2}h2{font-size:18px;margin:28px 0 10px}
.sub{color:var(--muted);margin:0 0 16px}.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;margin:12px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.kpi b{display:block;font-size:22px}.kpi span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.03em}.num{text-align:right;white-space:nowrap}
.tag{font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;border:1px solid var(--border);color:var(--muted);white-space:nowrap}
.tag.red{color:var(--accent);border-color:var(--accent)}.note{color:var(--muted);font-size:13px}
.cta{display:inline-block;background:var(--accent);color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600}
ul.cols{columns:2 260px;padding-left:18px}.scroll{overflow:auto}
"""


def pagina(titulo: str, descripcion: str, ruta: str, cuerpo: str, ld: list | None = None, profundidad: int = 0) -> str:
    raiz = "../" * profundidad
    url = BASE + ruta
    lds = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in (ld or []))
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(titulo)}</title>
<meta name="description" content="{e(descripcion)}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-snippet:-1">
<meta property="og:type" content="website"><meta property="og:title" content="{e(titulo)}">
<meta property="og:description" content="{e(descripcion)}"><meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="{raiz}favicon.svg">
<style>{CSS}</style>{lds}
</head>
<body><div class="wrap">
<header class="top"><a class="home" href="{raiz}index.html">🏛️ Congreso Abierto Perú</a>
<nav class="note"><a href="{raiz}congresistas/">Congresistas</a> · <a href="{raiz}bancadas.html">Bancadas</a> · <a href="{raiz}proveedores.html">Proveedores</a> · <a href="{raiz}index.html#bicameral">Tablero interactivo</a></nav></header>
{cuerpo}
<p class="note" style="margin-top:32px">Datos oficiales del Congreso de la República, el PTE, SEACE/OECE y las actas del Pleno, procesados por
<a href="https://github.com/unimauro/congreso-abierto-peru">Congreso Abierto Perú</a> (proyecto cívico independiente, licencia AGPL-3.0). Actualizado el {date.today().isoformat()}.</p>
</div></body></html>
"""


def principales_temas(pr: list) -> str:
    c = {}
    for p in pr:
        if not p["agenda"].startswith(("Actualización", "Otros")):
            c[p["agenda"]] = c.get(p["agenda"], 0) + 1
    return ", ".join(t.split(":")[0].lower() for t, _ in sorted(c.items(), key=lambda x: -x[1])[:2])


def ficha(m: dict, pl: dict | None, dp: dict | None, generado: str, vi: dict | None = None) -> tuple[str, str]:
    nombre = nombre_natural(m["nombre"])
    cargo = CARGO.get(m["camara"], "Congresista")
    s = slug(m["nombre"])
    pr = m.get("proyectos") or []
    asis = f'{pl["pct_asistencia"]}%' if pl and pl.get("pct_asistencia") is not None else "—"
    n_disc = (pl or {}).get("con_bancada", 0) + (pl or {}).get("contra_bancada", 0)
    disc = f'{pl["con_bancada"] / n_disc * 100:.1f}%' if n_disc else "—"
    desc = (f"{nombre}, {cargo.lower()} por {m.get('distrito') or 'Perú'} ({m.get('bancada')}), periodo 2026–2031: "
            f"{m.get('principal', 0)} proyectos de ley como autor principal"
            + (f" (sobre todo {temas_desc})" if (temas_desc := principales_temas(pr)) else "")
            + f", asistencia al Pleno {asis}"
            + (f", despacho de {dp['personal']} personas ({soles(dp['masa'])} al mes)" if dp else "") + ".")
    k = [("Proyectos como autor", m.get("principal", 0)), ("Firmas en proyectos", m.get("firmas", 0)),
         ("Agenda de desarrollo", m.get("desarrollo", 0)), ("Simbólicos", m.get("simbolicos", 0)),
         ("Asistencia al Pleno", asis), ("Vota con su bancada", disc)]
    if dp:
        k += [("Personal del despacho", dp["personal"]), ("Planilla del despacho / mes", soles(dp["masa"]))]
    kpis = "".join(f'<div class="kpi card"><b>{e(v)}</b><span>{e(t)}</span></div>' for t, v in k)
    pleno = ""
    if pl and pl.get("pases"):
        pleno = (f'<h2>En el Pleno</h2><div class="card"><p>Pases de lista: <b>{pl["presente"]}</b> presente, <b>{pl["ausente"]}</b> ausente, '
                 f'<b>{pl["licencia"]}</b> con licencia (de {pl["pases"]}). Votaciones nominales: <b>{pl["si"]}</b> SI, <b>{pl["no"]}</b> NO, '
                 f'<b>{pl["abst"]}</b> abstenciones y {pl["no_voto"]} sin votar (de {pl["votaciones"]}).'
                 + (f' Votó igual que la mayoría de su bancada en {pl["con_bancada"]} ocasiones y en contra en {pl["contra_bancada"]}.' if n_disc else "")
                 + '</p></div>')
    gasto = ""
    if dp:
        filas = "".join(f'<tr><td>{e(x["mes"])}</td><td class="num">{x["personal"]}</td><td class="num">{soles(x["masa"])}</td></tr>' for x in dp["serie"])
        gasto = (f'<h2>Gasto mensual del despacho</h2><div class="card scroll"><table><thead><tr><th>Mes</th><th class="num">Personas</th>'
                 f'<th class="num">Planilla</th></tr></thead><tbody>{filas}</tbody></table>'
                 '<p class="note">Solo la planilla del equipo (PTE). El PTE no publica por congresista su propia remuneración ni sus gastos operativos.</p></div>')
    filas_pr = "".join(f'<tr><td style="white-space:nowrap">{e(p["codigo"])}<div class="note">{e(p["fecha"])}</div></td><td>{e(p["titulo"])}'
                       f'<div class="note">{e(p["estado"])} · {e(p["agenda"])}</div></td></tr>' for p in pr)
    proyectos = (f'<h2>Proyectos de ley como autor principal ({len(pr)})</h2><div class="card scroll">'
                 + (f'<table><thead><tr><th>Código</th><th>Proyecto</th></tr></thead><tbody>{filas_pr}</tbody></table>' if pr else '<p class="note">Aún no presenta proyectos como autor principal.</p>')
                 + '</div>')
    cuenta = {}
    for p in pr:
        cuenta[p["agenda"]] = cuenta.get(p["agenda"], 0) + 1
    temas = sorted(cuenta.items(), key=lambda x: -x[1])
    tematicas = ("<h2>Temáticas que trabaja</h2><div class=\"card\"><ul>" + "".join(
        f"<li><b>{e(t)}</b>: {n} proyecto{'s' if n > 1 else ''}</li>" for t, n in temas)
        + "</ul><p class=\"note\">Eje de agenda de cada proyecto según palabras clave del título (indicativo).</p></div>") if temas else ""
    visitas = ""
    if vi and vi.get("total"):
        filas_v = "".join(f'<tr><td>{e(v["fecha"])}</td><td>{e(v["visitante"])}</td><td>{e(v["entidad"] or "—")}</td><td>{e(v["motivo"])}</td></tr>'
                          for v in vi["ultimas"][:15])
        ents = ", ".join(f"{e(x)} ({n})" for x, n in vi["top_entidades"][:5])
        visitas = (f'<h2>Visitas a su despacho ({vi["total"]})</h2><div class="card scroll"><p>{vi["al_congresista"]} visitas directas al congresista y el resto a su equipo'
                   + (f'. Instituciones más frecuentes: {ents}' if ents else "") + '.</p>'
                   f'<table><thead><tr><th>Fecha</th><th>Visitante</th><th>Institución</th><th>Motivo</th></tr></thead><tbody>{filas_v}</tbody></table>'
                   '<p class="note">Registro oficial de visitas del Congreso. No se publica el DNI de los visitantes.</p></div>')
    oficial = f'<a href="{e(m["link"])}" rel="nofollow">Perfil oficial</a> · ' if m.get("link") else ""
    cuerpo = f"""<p class="note"><a href="index.html">Congresistas</a> › {CAMARA[m["camara"]]}</p>
<h1>{e(nombre)}</h1>
<p class="sub">{cargo} por <b>{e(m.get("distrito") or "—")}</b> · {e(m.get("bancada") or "—")} · periodo 2026–2031 · datos al {e(generado)}</p>
<div class="kpis">{kpis}</div>
<p>{oficial}<a class="cta" href="../index.html#bicameral">Comparar con los demás en el tablero →</a></p>
{tematicas}{proyectos}{pleno}{gasto}{visitas}"""
    ld = [{"@context": "https://schema.org", "@type": "Person", "name": nombre, "jobTitle": f"{cargo} 2026–2031",
           "memberOf": [{"@type": "GovernmentOrganization", "name": CAMARA[m["camara"]] + " del Perú"},
                        {"@type": "Organization", "name": m.get("bancada")}],
           "homeLocation": {"@type": "Place", "name": m.get("distrito")},
           **({"sameAs": [m["link"]]} if m.get("link") else {}), "url": BASE + f"congresistas/{s}.html"}]
    titulo = f"{nombre} — {cargo} {m.get('sigla', '')} · proyectos, asistencia y gasto | Congreso Abierto Perú"
    return s, pagina(titulo, desc, f"congresistas/{s}.html", cuerpo, ld, profundidad=1)


def build() -> list[str]:
    bic, plenos, mov, con, integ, data, vis = (cargar(x) for x in ("bicameral.json", "plenos.json", "movimientos.json",
                                                                   "contratos.json", "integridad.json", "data.json", "visitas.json"))
    vi = {(x["camara"], x["nombre"]): x for x in (vis or {}).get("congresistas", [])}
    if not bic:
        raise SystemExit("[!] falta bicameral.json")
    pl = {(x["camara"], x["nombre"]): x for x in (plenos or {}).get("miembros", [])}
    dp = {(x["camara"], x["nombre"]): x for x in (mov or {}).get("despachos", [])}
    gen = bic["meta"]["generado"]
    urls = ["", "congresistas/", "bancadas.html", "proveedores.html"]
    os.makedirs(os.path.join(WEB, "congresistas"), exist_ok=True)

    # Fichas
    por_cam = {"D": [], "S": []}
    for m in bic["congresistas"]:
        s, doc = ficha(m, pl.get((m["camara"], m["nombre"])), dp.get((m["camara"], m["nombre"])), gen, vi.get((m["camara"], m["nombre"])))
        open(os.path.join(WEB, "congresistas", f"{s}.html"), "w", encoding="utf-8").write(doc)
        urls.append(f"congresistas/{s}.html")
        por_cam.setdefault(m["camara"], []).append((m, s))

    # Índice de congresistas
    secciones = ""
    for cam in ("S", "D"):
        filas = "".join(
            f'<tr><td><a href="{s}.html">{e(nombre_natural(m["nombre"]))}</a></td><td>{e(m.get("sigla"))}</td><td>{e(m.get("distrito"))}</td>'
            f'<td class="num">{m.get("principal", 0)}</td><td class="num">{e((pl.get((cam, m["nombre"])) or {}).get("pct_asistencia") or "—")}</td></tr>'
            for m, s in sorted(por_cam.get(cam, []), key=lambda x: x[0]["nombre"]))
        secciones += (f'<h2>{CAMARA[cam]} ({len(por_cam.get(cam, []))})</h2><div class="card scroll"><table><thead><tr><th>Nombre</th>'
                      f'<th>Bancada</th><th>Distrito</th><th class="num">Proyectos</th><th class="num">Asistencia %</th></tr></thead><tbody>{filas}</tbody></table></div>')
    idx = pagina("Diputados y senadores del Perú 2026–2031: proyectos, asistencia y gasto | Congreso Abierto Perú",
                 f"Fichas de los {len(bic['congresistas'])} congresistas del Perú (Senado y Cámara de Diputados 2026–2031): proyectos de ley, asistencia al Pleno, votos y gasto de despacho con datos oficiales.",
                 "congresistas/", f'<h1>Congresistas 2026–2031</h1><p class="sub">Senado y Cámara de Diputados · datos al {e(gen)}</p>{secciones}',
                 [{"@context": "https://schema.org", "@type": "CollectionPage", "name": "Congresistas del Perú 2026–2031", "url": BASE + "congresistas/"}],
                 profundidad=1)
    open(os.path.join(WEB, "congresistas", "index.html"), "w", encoding="utf-8").write(idx)

    # Bancadas
    cuerpo = '<h1>Producción legislativa por bancada</h1><p class="sub">Proyectos por grupo parlamentario con el filtro oficial de la API del Congreso.</p>'
    for cam in ("D", "S"):
        C = bic["camaras"][cam]
        filas = "".join(f'<tr><td>{e(b["bancada"])}</td><td class="num">{b.get("miembros") or "—"}</td><td class="num">{b["proyectos"]}</td>'
                        f'<td class="num">{b.get("por_miembro") or "—"}</td><td class="num">{b.get("pct_desarrollo", "—")}%</td></tr>' for b in C.get("bancadas", []))
        cuerpo += (f'<h2>{CAMARA[cam]} 2026–2031</h2><div class="card scroll"><table><thead><tr><th>Bancada</th><th class="num">Miembros</th>'
                   f'<th class="num">Proyectos</th><th class="num">Por miembro</th><th class="num">Desarrollo</th></tr></thead><tbody>{filas}</tbody></table></div>')
    if data and data.get("bancadas"):
        filas = "".join(f'<tr><td>{e(b["bancada"])}</td><td class="num">{b["proyectos"]:,}</td><td class="num">{b["leyes"]:,}</td>'
                        f'<td class="num">{b["pct_ley"]}%</td><td class="num">{b["pct_simbolico"]}%</td></tr>' for b in data["bancadas"])
        cuerpo += ('<h2>Congreso 2021–2026</h2><div class="card scroll"><table><thead><tr><th>Bancada</th><th class="num">Proyectos</th>'
                   f'<th class="num">Leyes</th><th class="num">% ley</th><th class="num">% simbólico</th></tr></thead><tbody>{filas}</tbody></table></div>')
    open(os.path.join(WEB, "bancadas.html"), "w", encoding="utf-8").write(pagina(
        "Bancadas del Congreso del Perú: proyectos y leyes por grupo parlamentario | Congreso Abierto Perú",
        "Cuántos proyectos y leyes presenta cada bancada del Congreso del Perú (2021–2026 y 2026–2031), con datos oficiales.",
        "bancadas.html", cuerpo))

    # Proveedores
    if con:
        sanc = {p["ruc"]: p for p in (integ or {}).get("proveedores", [])}
        filas = "".join(
            f'<tr><td>{e(p["nombre"])}' + (' <span class="tag red">inhabilitado hoy</span>' if sanc.get(p["ruc"], {}).get("vigente")
                                           else ' <span class="tag">sanción previa</span>' if sanc.get(p["ruc"], {}).get("sanciones") else "")
            + f'</td><td>{e(p["ruc"])}</td><td class="num">{p["procesos"]}</td><td class="num">{soles(p["monto"])}</td><td class="num">{p["pct"]}%</td></tr>'
            for p in con["proveedores"])
        t = con["totales"]
        cuerpo = (f'<h1>¿A quién le compra el Congreso del Perú?</h1><p class="sub">Contratos registrados en SEACE desde {e(con["meta"]["desde"])} · '
                  f'{t["procesos"]} procesos · {soles(t["monto"])} contratados con {t["proveedores"]} proveedores · el top 10 concentra el {t["top10_pct"]}%.</p>'
                  f'<div class="card scroll"><table><thead><tr><th>Proveedor</th><th>RUC</th><th class="num">Procesos</th><th class="num">Monto</th>'
                  f'<th class="num">% del total</th></tr></thead><tbody>{filas}</tbody></table>'
                  f'<p class="note">{e(con["meta"]["nota"])} Sanciones: Tribunal de Contrataciones (OECE). Una sanción pasada no impide volver a contratar.</p></div>')
        open(os.path.join(WEB, "proveedores.html"), "w", encoding="utf-8").write(pagina(
            "Proveedores y contratos del Congreso del Perú | Congreso Abierto Perú",
            f"Los {t['proveedores']} proveedores del Congreso del Perú desde {con['meta']['desde']}: montos, concentración y sanciones del Tribunal de Contrataciones.",
            "proveedores.html", cuerpo))

    # sitemap / robots / llms.txt
    hoy = date.today().isoformat()
    open(os.path.join(WEB, "sitemap.xml"), "w", encoding="utf-8").write(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{BASE}{u}</loc><lastmod>{hoy}</lastmod><changefreq>daily</changefreq>"
                  f"<priority>{'1.0' if not u else '0.8' if not u.startswith('congresistas/') or u.endswith('/') else '0.6'}</priority></url>\n" for u in urls)
        + "</urlset>\n")
    open(os.path.join(WEB, "robots.txt"), "w").write(f"User-agent: *\nAllow: /\nSitemap: {BASE}sitemap.xml\n")
    T = bic["totales"]
    open(os.path.join(WEB, "llms.txt"), "w", encoding="utf-8").write(f"""# Congreso Abierto Perú

> Observatorio cívico e independiente de datos abiertos del Congreso de la República del Perú. Cubre el Congreso bicameral 2026–2031 (Senado y Cámara de Diputados) y el periodo 2021–2026: proyectos de ley, asistencia y votaciones del Pleno, presupuesto, personal y planilla, contratos y proveedores. Datos al {gen}.

Todas las cifras salen de fuentes oficiales (API del Congreso, actas del Pleno, Portal de Transparencia Estándar, MEF, SEACE/OECE) y se actualizan a diario. Al citar, menciona la fuente oficial y la fecha de corte.

## Páginas
- [Tablero interactivo]({BASE}): resumen, bicameral, proyectos, presupuesto, comisiones, análisis, personal, contratos
- [Congresistas 2026–2031]({BASE}congresistas/): una ficha por cada uno de los {T['congresistas']} diputados y senadores
- [Bancadas]({BASE}bancadas.html): proyectos y leyes por grupo parlamentario
- [Proveedores]({BASE}proveedores.html): a quién le compra el Congreso y sanciones del Tribunal de Contrataciones

## Datos abiertos (JSON)
- [bicameral.json]({BASE}bicameral.json): {T['proyectos']} proyectos 2026–2031, por cámara, bancada, comisión y congresista
- [plenos.json]({BASE}plenos.json): asistencia y votaciones nominales del Pleno por congresista y bancada
- [movimientos.json]({BASE}movimientos.json): altas/bajas de personal y planilla mensual de cada despacho
- [personal.json]({BASE}personal.json): planilla nominal del Congreso (PTE)
- [contratos.json]({BASE}contratos.json): procesos de contratación y proveedores (OCDS/SEACE)
- [visitas.json]({BASE}visitas.json): visitas registradas a cada despacho congresal (sin DNI)
- [integridad.json]({BASE}integridad.json): proveedores con sanciones del Tribunal de Contrataciones
- [data.json]({BASE}data.json): proyectos de ley 2021–2026 y producción por bancada
- [context.json]({BASE}context.json): presupuesto del pliego Congreso (MEF)

## Código
- [Repositorio](https://github.com/unimauro/congreso-abierto-peru) (AGPL-3.0)
""")
    return urls


if __name__ == "__main__":
    u = build()
    print(f"[ok] {len(u)} URLs en sitemap.xml · {len(u) - 4} fichas de congresistas")
