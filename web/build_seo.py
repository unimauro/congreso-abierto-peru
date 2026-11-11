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
:root{--bg:#f6f7f9;--panel:#fff;--panel-2:#fafbfc;--border:#e6e8ec;--text:#16181d;--muted:#5b626f;--accent:#e23744;--accent-2:#2563eb;
--green:#16a34a;--amber:#d97706;--purple:#7c3aed;--shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06)}
@media (prefers-color-scheme:dark){:root{--bg:#0a0b0d;--panel:#121317;--panel-2:#16181d;--border:#23262e;--text:#e7e9ee;--muted:#9aa1ad;--accent-2:#60a5fa;--shadow:none}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent-2);text-decoration:none}a:hover{text-decoration:underline}
.bar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--panel) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.bar .in{max-width:1120px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:8px;font-weight:800;color:var(--text)}.brand:hover{text-decoration:none}
.logo{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--accent);color:#fff;font-size:13px;font-weight:800}
.bar nav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}.bar nav a{color:var(--muted);font-weight:600;font-size:14px;padding:6px 10px;border-radius:8px}
.bar nav a:hover,.bar nav a.on{background:var(--panel-2);color:var(--text);text-decoration:none}
.wrap{max-width:1120px;margin:0 auto;padding:20px 16px 56px}
h1{font-size:clamp(24px,4vw,34px);margin:0;line-height:1.15;letter-spacing:-.02em}h2{font-size:17px;margin:0 0 12px;letter-spacing:-.01em}
.sub{color:var(--muted);margin:6px 0 0}.note{color:var(--muted);font-size:13px}.crumb{font-size:13px;color:var(--muted);margin-bottom:12px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:var(--shadow);min-width:0}
.hero{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center;padding:22px}
.hero img,.ph{width:132px;height:132px;border-radius:18px;object-fit:cover;object-position:top;border:1px solid var(--border);background:var(--panel-2)}
.ph{display:grid;place-items:center;font-size:40px;font-weight:800;color:var(--muted)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:var(--panel-2);border:1px solid var(--border);color:var(--text)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--c,#94a3b8)}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.btn{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:14px;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--text)}
.btn.pri{background:var(--accent);border-color:var(--accent);color:#fff}.btn:hover{text-decoration:none;filter:brightness(.97)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
.kpi{padding:14px 16px}.kpi .v{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.1}.kpi .l{font-size:13px;color:var(--muted);margin-top:2px}
.kpi .c{font-size:12px;margin-top:8px;color:var(--muted)}.up{color:var(--green);font-weight:700}.down{color:var(--accent);font-weight:700}
.cols{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px;align-items:start}.stack{display:grid;gap:16px}
.hb{display:grid;grid-template-columns:minmax(0,170px) 1fr auto;gap:10px;align-items:center;font-size:13px;margin:7px 0}
.hb .t{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hb .tr{display:block;height:8px;border-radius:99px;background:color-mix(in srgb,var(--border) 70%,transparent);overflow:hidden}
.hb .f{display:block;height:100%;border-radius:99px;background:var(--c,var(--accent-2))}
main>h2{margin:28px 0 10px}main>.card+.card{margin-top:14px}.hb b{min-width:44px;text-align:right}
.seg{display:flex;height:12px;border-radius:99px;overflow:hidden;background:var(--panel-2);margin:8px 0}.seg span{display:block;height:100%}
.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-1px}
ul.clean{list-style:none;margin:0;padding:0}ul.clean li{padding:9px 0;border-bottom:1px solid var(--border)}ul.clean li:last-child{border-bottom:0}
.role{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:var(--panel-2);border:1px solid var(--border);color:var(--muted);white-space:nowrap}
.role.top{color:var(--green);border-color:color-mix(in srgb,var(--green) 40%,var(--border))}
.proj{padding:12px 0;border-bottom:1px solid var(--border)}.proj:last-child{border-bottom:0}.proj .code{font:600 12px/1 ui-monospace,Menlo,monospace;color:var(--accent-2)}
.proj .t{margin:4px 0;font-size:14px}.scrollbox{max-height:520px;overflow:auto;padding-right:4px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:9px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}.num{text-align:right;white-space:nowrap}.scroll{overflow:auto}
.tag{font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;border:1px solid var(--border);color:var(--muted);white-space:nowrap}
.tag.red{color:var(--accent);border-color:var(--accent)}
.foot{margin-top:36px;font-size:13px;color:var(--muted);border-top:1px solid var(--border);padding-top:16px}
/* índice */
.tools{display:grid;grid-template-columns:minmax(0,2fr) repeat(4,minmax(0,1fr));gap:10px;margin:18px 0 10px}
.tools input,.tools select{width:100%;font:inherit;font-size:14px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--text)}
.tools input:focus,.tools select:focus{outline:2px solid color-mix(in srgb,var(--accent-2) 50%,transparent);outline-offset:1px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.mc{display:flex;flex-direction:column;gap:10px;padding:14px;color:var(--text);transition:transform .12s,box-shadow .12s}
.mc:hover{text-decoration:none;transform:translateY(-2px);box-shadow:0 10px 28px rgba(16,24,40,.10)}
.mc .top{display:flex;gap:12px;align-items:center}.mc img,.mc .ph{width:58px;height:58px;border-radius:14px;font-size:20px}
.mc .n{font-weight:700;line-height:1.25}.mc .d{font-size:12px;color:var(--muted)}
.mc .st{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;border-top:1px solid var(--border);padding-top:10px}
.mc .st div{font-size:11px;color:var(--muted)}.mc .st b{display:block;font-size:15px;color:var(--text)}
.pager{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin:22px 0 4px}
.pager button{font:inherit;font-size:14px;min-width:38px;padding:7px 11px;border-radius:9px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer}
.pager button.on{background:var(--accent);border-color:var(--accent);color:#fff}.pager button:disabled{opacity:.4;cursor:default}
.count{font-size:13px;color:var(--muted)}.empty{padding:40px;text-align:center;color:var(--muted)}
@media (max-width:860px){.cols{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.tools{grid-template-columns:1fr 1fr}.tools input{grid-column:1/-1}}
@media (max-width:520px){.hero{grid-template-columns:1fr;text-align:left}.hero img,.ph{width:96px;height:96px}.hb{grid-template-columns:minmax(0,110px) 1fr auto}.bar nav{margin-left:0}}
"""

# Color por bancada (solo para distinguir; no son colores oficiales)
COLOR_BANCADA = {"FP": "#f97316", "JP": "#dc2626", "RP": "#0ea5e9", "AN": "#16a34a", "PBG": "#7c3aed", "PCO": "#0891b2",
                 "APP": "#2563eb", "PP": "#db2777", "SP": "#ca8a04"}


def color(sigla: str) -> str:
    return COLOR_BANCADA.get(sigla or "", "#94a3b8")


def iniciales(nombre: str) -> str:
    p = [x for x in nombre.split() if x[:1].isalpha()]
    return (p[0][0] + (p[-1][0] if len(p) > 1 else "")).upper() if p else "?"


def pagina(titulo: str, descripcion: str, ruta: str, cuerpo: str, ld: list | None = None, profundidad: int = 0,
           seccion: str = "", imagen: str | None = None, script: str = "") -> str:
    raiz = "../" * profundidad
    url = BASE + ruta
    lds = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in (ld or []))
    nav = "".join(f'<a href="{raiz}{h}"{" class=on" if seccion == k else ""}>{t}</a>' for k, h, t in (
        ("cong", "congresistas/", "Congresistas"), ("banc", "bancadas.html", "Bancadas"),
        ("prov", "proveedores.html", "Proveedores"), ("tab", "index.html#bicameral", "Tablero")))
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(titulo)}</title>
<meta name="description" content="{e(descripcion)}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<meta name="theme-color" content="#e23744">
<meta property="og:type" content="website"><meta property="og:site_name" content="Congreso Abierto Perú"><meta property="og:title" content="{e(titulo)}">
<meta property="og:description" content="{e(descripcion)}"><meta property="og:url" content="{url}">
<meta property="og:image" content="{e(imagen or BASE + 'og.png')}">{'<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' if not imagen or '/og/' in imagen else ''}
<meta name="twitter:card" content="{'summary' if imagen and '/og/' not in imagen else 'summary_large_image'}"><meta name="twitter:image" content="{e(imagen or BASE + 'og.png')}">
<link rel="icon" type="image/svg+xml" href="{raiz}favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>{CSS}</style>{lds}
</head>
<body>
<header class="bar"><div class="in"><a class="brand" href="{raiz}index.html"><span class="logo">CA</span>Congreso Abierto Perú</a><nav>{nav}</nav></div></header>
<main class="wrap">
{cuerpo}
<p class="foot">Datos oficiales del Congreso de la República, el Portal de Transparencia Estándar, SEACE/OECE y las actas del Pleno, procesados por
<a href="https://github.com/unimauro/congreso-abierto-peru">Congreso Abierto Perú</a> (proyecto cívico independiente, licencia AGPL-3.0). Actualizado el {date.today().isoformat()}.</p>
</main>{script}</body></html>
"""


def barras(items: list[tuple[str, float, str]], fmt=lambda v: f"{v:,.0f}") -> str:
    mx = max((v for _, v, _ in items), default=0) or 1
    return "".join(f'<div class="hb"><span class="t" title="{e(t)}">{e(t)}</span><span class="tr"><span class="f" style="width:{v / mx * 100:.0f}%;--c:{c}"></span></span><b>{e(fmt(v))}</b></div>'
                   for t, v, c in items)


def url_expediente(codigo: str) -> str | None:
    """Expediente oficial en el portal SPLEY: -CD Diputados, -S Senado, -CR bicameral."""
    m = re.match(r"^0*(\d+)-(\d{4})-\d{4}-(CD|S|CR)$", codigo or "")
    if not m:
        return None
    return f"https://wb2server.congreso.gob.pe/spley-portal/#/{ {'CD': 'diputados', 'S': 'senado', 'CR': 'congreso'}[m[3]] }/expediente/{m[2]}/{m[1]}"


def mediana(xs: list[float]) -> float | None:
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def comparacion(v, ref, unidad="", mayor_mejor=True, fmt=lambda x: f"{x:,.0f}") -> str:
    if v is None or ref is None:
        return ""
    if abs(v - ref) < 1e-9:
        return f'igual a la mediana de su cámara ({fmt(ref)}{unidad})'
    arriba = v > ref
    cls = "up" if arriba == mayor_mejor else "down"
    return f'<span class="{cls}">{"▲" if arriba else "▼"}</span> mediana de su cámara: {fmt(ref)}{unidad}'


def principales_temas(pr: list) -> str:
    c = {}
    for p in pr:
        if not p["agenda"].startswith(("Actualización", "Otros")):
            c[p["agenda"]] = c.get(p["agenda"], 0) + 1
    return ", ".join(t.split(":")[0].lower() for t, _ in sorted(c.items(), key=lambda x: -x[1])[:2])


VOTO_TXT = {"S": "SI", "N": "NO", "A": "Abstención", "X": "Ausente", "L": "Licencia", "R": "Sin responder", "P": "Presente", "-": "Sin dato"}
VOTO_COLOR = {"S": "var(--green)", "N": "var(--accent)", "A": "var(--amber)"}
POS_COD = {"si": "S", "no": "N", "abst": "A"}


def como_voto(m: dict, plenos: dict | None, n: int = 15) -> list[dict]:
    """Últimas `n` votaciones nominales del congresista (ver `votos` en plenos.json)."""
    c = ((plenos or {}).get("camaras") or {}).get(m["camara"]) or {}
    orden = c.get("nominal_orden") or []
    if m["nombre"] not in orden:
        return []
    i = orden.index(m["nombre"])
    out = []
    for v in sorted((v for v in c.get("votaciones", []) if v.get("votos")), key=lambda v: v["id"], reverse=True)[:n]:
        cod = v["votos"][i] if i < len(v["votos"]) else "-"
        pos = POS_COD.get((v.get("posicion") or {}).get(m.get("sigla")))
        out.append({"fecha": v["fecha"], "asunto": v.get("asunto") or "(sin asunto)", "voto": cod, "bancada": pos,
                    "contra": bool(pos and cod in "SNA" and cod != pos)})
    return out


def seccion_como_voto(m: dict, cv: list[dict]) -> str:
    if not cv:
        return ""
    filas = "".join(
        f'<tr><td class="note" style="white-space:nowrap">{e(x["fecha"])}</td><td title="{e(x["asunto"])}">{e(x["asunto"][:150] + ("…" if len(x["asunto"]) > 150 else ""))}</td>'
        f'<td style="white-space:nowrap"><b style="color:{VOTO_COLOR.get(x["voto"], "var(--muted)")}">{VOTO_TXT[x["voto"]]}</b>{" <span class=\"tag red\">⚠ contra su bancada</span>" if x["contra"] else ""}</td>'
        f'<td class="note">{VOTO_TXT[x["bancada"]] if x["bancada"] else "—"}</td></tr>' for x in cv)
    n_contra = sum(x["contra"] for x in cv)
    return (f'<section class="card"><h2>🗳️ Cómo votó (últimas {len(cv)} votaciones)</h2><div class="scroll">'
            f'<table><thead><tr><th>Fecha</th><th>Asunto</th><th>Su voto</th><th>{e(m.get("sigla") or "Bancada")}</th></tr></thead><tbody>{filas}</tbody></table></div>'
            f'<p class="note">Votó distinto que la mayoría de su bancada en {n_contra} de {len(cv)}. Votaciones nominales del Pleno leídas del acta oficial '
            '(OCR) y validadas contra el total oficial; verifica en el acta.</p></section>')


def seccion_intereses(vs: list[dict]) -> str:
    if not vs:
        return ""
    items = ""
    for v in vs:
        activa = (v.get("estado_sunat") or "").upper() == "ACTIVO"
        sen = "".join(f'<li>⚠ <b>{e(x["sector"])}</b>: {e(x["detalle"])}</li>' for x in v["senales"])
        items += (f'<li><b>{e(v["empresa"])}</b> <span class="note">RUC {e(v["ruc"])}</span><br>'
                  f'<span class="role{" top" if activa else ""}">{e(v["rol"])}</span> '
                  f'<span class="tag{"" if activa else " red"}">SUNAT: {e(v["estado_sunat"])}</span>'
                  + (f' <span class="tag">vende al Estado: {e(", ".join(v["vende_al_estado"]))}</span>' if v["vende_al_estado"] else "")
                  + (f'<div class="note">Rubro estimado: {e(", ".join(v["sector_estimado"]))}</div>' if v["sector_estimado"] else "")
                  + f'<div class="note">✔ Sin contratos con el Estado desde el inicio del mandato (27-jul-2026).'
                  + (f' Ficha OECE: <a href="{e(v["ficha"])}" rel="nofollow noopener" target="_blank">ver ↗</a>' if v.get("ficha") else "") + '</div>'
                  + (f'<div style="margin-top:8px"><b>Posible conflicto de interés a revisar</b><ul>{sen}</ul></div>' if sen else "")
                  + "</li>")
    return (f'<section class="card"><h2>💼 Participación en empresas</h2><ul class="clean">{items}</ul>'
            '<p class="note">Vínculo verificado por el OECE con el DNI del congresista (registro de funcionarios de la Contraloría). '
            'Tener una empresa no es irregular; la ley impide a los congresistas contratar con el Estado durante su mandato. '
            'Un "posible conflicto de interés" es una coincidencia de sector con sus comisiones o proyectos y requiere revisión.</p></section>')


def ficha(m: dict, pl: dict | None, dp: dict | None, generado: str, vi: dict | None = None, pf: dict | None = None,
          ctx: dict | None = None, cv: list | None = None, it: list | None = None) -> tuple[str, str]:
    ctx = ctx or {}
    nombre = nombre_natural(m["nombre"])
    cargo = CARGO.get(m["camara"], "Congresista")
    s = slug(m["nombre"])
    pr = m.get("proyectos") or []
    asis_v = pl.get("pct_asistencia") if pl else None
    asis = f"{asis_v}%" if asis_v is not None else "—"
    n_disc = (pl or {}).get("con_bancada", 0) + (pl or {}).get("contra_bancada", 0)
    desc = (f"{nombre}, {cargo.lower()} por {m.get('distrito') or 'Perú'} ({m.get('bancada')}), periodo 2026–2031: "
            f"{m.get('principal', 0)} proyectos de ley como autor principal"
            + (f" (sobre todo {temas_desc})" if (temas_desc := principales_temas(pr)) else "")
            + f", asistencia al Pleno {asis}"
            + (f", despacho de {dp['personal']} personas ({soles(dp['masa'])} al mes)" if dp else "") + ".")
    foto = pf.get("foto") if pf else None
    cbanc = color(m.get("sigla"))

    # Encabezado
    img = (f'<img src="{e(foto)}" alt="Foto oficial de {e(nombre)}" width="132" height="132">' if foto
           else f'<div class="ph" aria-hidden="true">{e(iniciales(nombre))}</div>')
    presid = [c for c in (pf or {}).get("comisiones", []) if re.match(r"(Presid|Vicepres|Primer|Segund|Tercer)", c["cargo"])]
    chips = (f'<span class="chip">{"🏛️ Senado" if m["camara"] == "S" else "🏛️ Cámara de Diputados"}</span>'
             f'<span class="chip" style="--c:{cbanc}"><span class="dot"></span>{e(m.get("bancada") or "—")}</span>'
             f'<span class="chip">📍 {e(m.get("distrito") or "—")}</span>'
             + "".join(f'<span class="chip">⭐ {e(c["cargo"])} · {e(re.sub(r"^Comisi[oó]n (de |Bicameral de )?", "", c["organo"]))}</span>' for c in presid[:2]))
    oficial = f'<a class="btn" href="{e(m["link"])}" rel="nofollow noopener" target="_blank">Perfil oficial ↗</a>' if m.get("link") else ""
    hero = f"""<div class="crumb"><a href="index.html">Congresistas</a> › {CAMARA[m["camara"]]}</div>
<section class="card hero">{img}<div><h1>{e(nombre)}</h1>
<p class="sub">{cargo} por {e(m.get("distrito") or "—")} · periodo 2026–2031</p><div class="chips">{chips}</div>
<div class="acts"><a class="btn pri" href="../index.html#bicameral?cam={m["camara"]}&c={s}">Ver en el tablero</a>
<a class="btn" href="../index.html#comparar?c={s}">Comparar</a>{oficial}</div></div></section>"""

    # Indicadores con contexto de la cámara
    def kpi(v, l, c=""):
        return f'<div class="card kpi"><div class="v">{v}</div><div class="l">{l}</div>{f"<div class=c>{c}</div>" if c else ""}</div>'
    k = [kpi(m.get("principal", 0), "proyectos como autor principal",
             comparacion(m.get("principal", 0), ctx.get("principal"))),
         kpi(asis, "asistencia al Pleno",
             comparacion(asis_v, ctx.get("asistencia"), "%", fmt=lambda x: f"{x:.1f}") if asis_v is not None else "sin pases de lista procesados"),
         kpi(soles(dp["masa"]) if dp else "—", "planilla del despacho al mes",
             (f'{dp["personal"]} personas · ' + comparacion(dp["masa"], ctx.get("masa"), mayor_mejor=False, fmt=lambda x: soles(x))) if dp else "despacho no identificado"),
         kpi(f'{vi["total"]:,}' if vi else "—", "visitas a su despacho",
             (f'{vi["al_congresista"]:,} directas · ' + comparacion(vi["total"], ctx.get("visitas"))) if vi else "")]
    kpis = f'<div class="kpis">{"".join(k)}</div>'

    # Columna principal
    cuenta = {}
    for p in pr:
        cuenta[p["agenda"]] = cuenta.get(p["agenda"], 0) + 1
    def col_eje(t):
        return "var(--purple)" if t.startswith("Simbólico") else "#94a3b8" if t.startswith(("Actualización", "Otros", "Reforma")) else "var(--green)"
    tematicas = (f'<section class="card"><h2>🧭 Temáticas que trabaja</h2>{barras([(t, n, col_eje(t)) for t, n in sorted(cuenta.items(), key=lambda x: -x[1])])}'
                 '<p class="note">Eje de agenda de cada proyecto según palabras clave del título (indicativo). Verde: desarrollo; morado: simbólico.</p></section>') if cuenta else ""
    proys = "".join(f'<div class="proj"><a class="code" href="{e(url_expediente(p["codigo"]) or "#")}" target="_blank" rel="noopener" title="Expediente y texto oficial">{e(p["codigo"])} ↗</a> <span class="note">· {e(p["fecha"])}</span>'
                    f'<div class="t">{e(p["titulo"])}</div><span class="tag">{e(p["estado"])}</span> <span class="tag">{e(p["agenda"])}</span></div>' for p in pr)
    proyectos = (f'<section class="card"><h2>📄 Proyectos de ley como autor principal ({len(pr)})</h2>'
                 + (f'<div class="scrollbox">{proys}</div>' if pr else '<p class="note">Aún no presenta proyectos como autor principal.</p>')
                 + f'<p class="note">Además firmó {m.get("firmas", 0)} proyectos como coautor.</p></section>')
    comis = ""
    if pf:
        items = "".join(f'<li><b>{e(c["organo"])}</b><br><span class="role{" top" if re.match(r"(Presid|Vicepres|Primer|Segund|Tercer|Secret)", c["cargo"]) else ""}">{e(c["cargo"])}</span> <span class="note">{e(c["tipo"])}</span></li>'
                        for c in pf["comisiones"])
        comis = f'<section class="card"><h2>🏛️ Comisiones y cargos ({len(pf["comisiones"])})</h2><ul class="clean">{items or "<li class=note>Sin comisiones activas.</li>"}</ul></section>'
    visitas = ""
    if vi and vi.get("total"):
        filas_v = "".join(f'<tr><td class="note" style="white-space:nowrap">{e(v["fecha"])}</td><td>{e(v["visitante"])}<div class="note">{e(v["entidad"] or "—")}</div></td><td>{e(v["motivo"])}</td></tr>'
                          for v in vi["ultimas"][:15])
        visitas = (f'<section class="card"><h2>🚪 Últimas visitas a su despacho</h2><div class="scroll"><table><thead><tr><th>Fecha</th><th>Visitante</th><th>Motivo</th></tr></thead>'
                   f'<tbody>{filas_v}</tbody></table></div><p class="note">Registro oficial de visitas del Congreso. No se publica el DNI de los visitantes.</p></section>')

    # Columna lateral
    pleno = ""
    if pl and pl.get("pases"):
        tot = pl["pases"] or 1
        segs = [("Presente", pl["presente"], "var(--green)"), ("Licencia", pl["licencia"], "var(--amber)"), ("Ausente", pl["ausente"], "var(--accent)")]
        tv = pl["votaciones"] or 1
        segv = [("SI", pl["si"], "var(--green)"), ("NO", pl["no"], "var(--accent)"), ("Abst.", pl["abst"], "var(--amber)"), ("Sin votar", pl["no_voto"], "#94a3b8")]
        bar = lambda xs, t: '<div class="seg">' + "".join(f'<span style="width:{n / t * 100:.1f}%;background:{c}" title="{l}: {n}"></span>' for l, n, c in xs) + "</div>"
        ley = lambda xs: '<div class="legend">' + "".join(f'<span><i style="background:{c}"></i>{l} {n}</span>' for l, n, c in xs) + "</div>"
        pleno = (f'<section class="card"><h2>🗳️ En el Pleno</h2><div class="note">Pases de lista ({pl["pases"]})</div>{bar(segs, tot)}{ley(segs)}'
                 f'<div class="note" style="margin-top:14px">Votaciones nominales ({pl["votaciones"]})</div>{bar(segv, tv)}{ley(segv)}'
                 + (f'<p style="margin:14px 0 0">Votó con la mayoría de su bancada <b>{pl["con_bancada"] / n_disc * 100:.0f}%</b> de las veces '
                    f'({pl["contra_bancada"]} en contra).</p>' if n_disc else "") + '</section>')
    gasto = ""
    if dp:
        gasto = (f'<section class="card"><h2>💸 Planilla del despacho</h2>{barras([(x["mes"], x["masa"], "var(--accent-2)") for x in dp["serie"]], fmt=lambda v: soles(v))}'
                 f'<p class="note">≈ {soles(dp["masa"] * 14)} al año (14 sueldos). Solo la planilla de su equipo según el PTE: no incluye su propia remuneración ni gastos operativos.</p></section>')
    ents = ""
    if vi and vi.get("top_entidades"):
        ents = f'<section class="card"><h2>🏢 Quiénes lo visitan más</h2>{barras([(x, n, "var(--purple)") for x, n in vi["top_entidades"][:6]])}</section>'
    agenda = ""
    if pf and pf.get("representacion"):
        items = "".join(f'<li><b>{e(r["fecha"])}</b> · {e(r["lugar"] or "—")}' + (f' · <a href="{e(r["pdf"])}" rel="nofollow" target="_blank">informe ↗</a>' if r.get("pdf") else "") + "</li>"
                        for r in pf["representacion"][:8])
        agenda = f'<section class="card"><h2>📅 Semana de representación</h2><ul class="clean">{items}</ul></section>'

    cuerpo = f"""{hero}{kpis}
<div class="cols"><div class="stack">{tematicas}{proyectos}{seccion_como_voto(m, cv or [])}{comis}{visitas}</div>
<aside class="stack">{seccion_intereses(it or [])}{pleno}{gasto}{ents}{agenda}</aside></div>
<p class="note" style="margin-top:16px">Datos al {e(generado)}.</p>"""
    ld = [{"@context": "https://schema.org", "@type": "Person", "name": nombre, "jobTitle": f"{cargo} 2026–2031",
           "memberOf": [{"@type": "GovernmentOrganization", "name": CAMARA[m["camara"]] + " del Perú"},
                        {"@type": "Organization", "name": m.get("bancada")}],
           "homeLocation": {"@type": "Place", "name": m.get("distrito")},
           **({"sameAs": [m["link"]]} if m.get("link") else {}), **({"image": foto} if foto else {}),
           "url": BASE + f"congresistas/{s}.html"}]
    titulo = f"{nombre} — {cargo} {m.get('sigla', '')} · proyectos, asistencia y gasto | Congreso Abierto Perú"
    og = next((f"og/{s}.{x}" for x in ("jpg", "png") if os.path.exists(os.path.join(WEB, "og", f"{s}.{x}"))), None)
    return s, pagina(titulo, desc, f"congresistas/{s}.html", cuerpo, ld, profundidad=1, seccion="cong",
                     imagen=(BASE + og) if og else foto)


INDICE_JS = r"""<script>
(() => {
  const $ = (s) => document.querySelector(s), cards = [...document.querySelectorAll('.mc')];
  const norm = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const st = { q: '', cam: '', banc: '', dist: '', ord: 'nombre', p: 1 }, PS = 24;
  try { const u = new URLSearchParams(location.hash.slice(1)); for (const k in st) if (u.get(k)) st[k] = k === 'p' ? +u.get(k) : u.get(k); } catch (e) {}
  const fill = (id, attr) => { const vals = [...new Set(cards.map(c => c.dataset[attr]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    $(id).insertAdjacentHTML('beforeend', vals.map(v => `<option>${v.replace(/</g, '&lt;')}</option>`).join('')); };
  fill('#f-banc', 'banc'); fill('#f-dist', 'dist');
  ['q', 'cam', 'banc', 'dist', 'ord'].forEach(k => { const el = $('#f-' + k); el.value = st[k];
    el.addEventListener('input', () => { st[k] = el.value; st.p = 1; render(); }); });
  const num = (c, k) => +(c.dataset[k] || -1);
  function render() {
    const q = norm(st.q);
    let vis = cards.filter(c => (!st.cam || c.dataset.cam === st.cam) && (!st.banc || c.dataset.banc === st.banc) &&
      (!st.dist || c.dataset.dist === st.dist) && (!q || c.dataset.txt.includes(q)));
    const o = st.ord;
    vis.sort((a, b) => o === 'nombre' ? a.dataset.nom.localeCompare(b.dataset.nom, 'es') : num(b, o) - num(a, o) || a.dataset.nom.localeCompare(b.dataset.nom, 'es'));
    const pages = Math.max(1, Math.ceil(vis.length / PS)); st.p = Math.min(Math.max(1, st.p), pages);
    const ini = (st.p - 1) * PS, pag = new Set(vis.slice(ini, ini + PS));
    const grid = $('#grid'); cards.forEach(c => c.hidden = !pag.has(c)); vis.forEach(c => grid.appendChild(c));
    $('#empty').hidden = vis.length > 0;
    $('#count').textContent = vis.length ? `${ini + 1}–${Math.min(ini + PS, vis.length)} de ${vis.length} congresistas` : '0 congresistas';
    const btn = (t, p, on, dis) => `<button type="button" data-p="${p}"${on ? ' class="on" aria-current="page"' : ''}${dis ? ' disabled' : ''}>${t}</button>`;
    let h = btn('‹', st.p - 1, false, st.p === 1);
    for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - st.p) <= 1) h += btn(i, i, i === st.p); else if (Math.abs(i - st.p) === 2) h += '<span class="note">…</span>';
    $('#pager').innerHTML = h + btn('›', st.p + 1, false, st.p === pages);
    const u = new URLSearchParams(); for (const k in st) if (st[k] && !(k === 'p' && st[k] === 1) && !(k === 'ord' && st[k] === 'nombre')) u.set(k, st[k]);
    history.replaceState(null, '', u.toString() ? '#' + u : location.pathname);
  }
  $('#pager').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-p]'); if (!b || b.disabled) return;
    st.p = +b.dataset.p; render(); $('#tools').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  document.addEventListener('keydown', (ev) => { if (ev.key === '/' && document.activeElement.tagName !== 'INPUT') { ev.preventDefault(); $('#f-q').focus(); } });
  render();
})();
</script>"""


def tarjeta(m: dict, s: str, pl: dict | None, dp: dict | None, vi: dict | None, pf: dict | None) -> str:
    nombre = nombre_natural(m["nombre"])
    foto = pf.get("foto") if pf else None
    img = (f'<img src="{e(foto)}" alt="" loading="lazy" width="58" height="58">' if foto else f'<div class="ph" aria-hidden="true">{e(iniciales(nombre))}</div>')
    asis = pl.get("pct_asistencia") if pl else None
    txt = " ".join([nombre, m["nombre"], m.get("bancada") or "", m.get("sigla") or "", m.get("distrito") or ""])
    txt = unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode().lower()
    return (f'<a class="card mc" href="{s}.html" data-cam="{m["camara"]}" data-banc="{e(m.get("bancada") or "")}" data-dist="{e(m.get("distrito") or "")}"'
            f' data-nom="{e(m["nombre"])}" data-txt="{e(txt)}" data-proy="{m.get("principal", 0)}" data-asis="{asis if asis is not None else -1}"'
            f' data-vis="{vi["total"] if vi else -1}" data-masa="{dp["masa"] if dp else -1}">'
            f'<div class="top">{img}<div><div class="n">{e(nombre)}</div><div class="d">{"Senado" if m["camara"] == "S" else "Diputados"} · {e(m.get("distrito") or "—")}</div>'
            f'<span class="chip" style="--c:{color(m.get("sigla"))};margin-top:6px"><span class="dot"></span>{e(m.get("sigla") or "—")}</span></div></div>'
            f'<div class="st"><div><b>{m.get("principal", 0)}</b>proyectos</div><div><b>{f"{asis:.0f}%" if asis is not None else "—"}</b>asistencia</div>'
            f'<div><b>{f"{vi["total"]:,}" if vi else "—"}</b>visitas</div></div></a>')


def build() -> list[str]:
    bic, plenos, mov, con, integ, data, vis = (cargar(x) for x in ("bicameral.json", "plenos.json", "movimientos.json",
                                                                   "contratos.json", "integridad.json", "data.json", "visitas.json"))
    vi = {(x["camara"], x["nombre"]): x for x in (vis or {}).get("congresistas", [])}
    pfs = {(x["camara"], x["nombre"]): x for x in (cargar("perfiles.json") or {}).get("perfiles", [])}
    ints = {}
    for x in (cargar("intereses.json") or {}).get("vinculos", []):
        ints.setdefault((x["camara"], x["congresista"]), []).append(x)
    if not bic:
        raise SystemExit("[!] falta bicameral.json")
    pl = {(x["camara"], x["nombre"]): x for x in (plenos or {}).get("miembros", [])}
    dp = {(x["camara"], x["nombre"]): x for x in (mov or {}).get("despachos", [])}
    gen = bic["meta"]["generado"]
    urls = ["", "congresistas/", "bancadas.html", "proveedores.html"]
    os.makedirs(os.path.join(WEB, "congresistas"), exist_ok=True)

    # Medianas por cámara para dar contexto a cada ficha
    ctx = {}
    for cam in ("D", "S"):
        ms = [m for m in bic["congresistas"] if m["camara"] == cam]
        k = lambda m: (cam, m["nombre"])
        ctx[cam] = {"principal": mediana([m.get("principal", 0) for m in ms]),
                    "asistencia": mediana([(pl.get(k(m)) or {}).get("pct_asistencia") for m in ms]),
                    "masa": mediana([(dp.get(k(m)) or {}).get("masa") for m in ms]),
                    "visitas": mediana([(vi.get(k(m)) or {}).get("total") for m in ms])}

    # Fichas
    por_cam = {"D": [], "S": []}
    for m in bic["congresistas"]:
        s, doc = ficha(m, pl.get((m["camara"], m["nombre"])), dp.get((m["camara"], m["nombre"])), gen, vi.get((m["camara"], m["nombre"])),
                       pfs.get((m["camara"], m["nombre"])), ctx.get(m["camara"]), como_voto(m, plenos), ints.get((m["camara"], m["nombre"])))
        open(os.path.join(WEB, "congresistas", f"{s}.html"), "w", encoding="utf-8").write(doc)
        urls.append(f"congresistas/{s}.html")
        por_cam.setdefault(m["camara"], []).append((m, s))

    # Índice de congresistas: tarjetas en el HTML (rastreables) + buscador, filtros y paginación en JS
    todos = sorted(((m, sl) for c in por_cam.values() for m, sl in c), key=lambda x: x[0]["nombre"])
    k = lambda m: (m["camara"], m["nombre"])
    cards = "".join(tarjeta(m, sl, pl.get(k(m)), dp.get(k(m)), vi.get(k(m)), pfs.get(k(m))) for m, sl in todos)
    nS, nD = len(por_cam.get("S", [])), len(por_cam.get("D", []))
    cuerpo = f"""<h1>Congresistas 2026–2031</h1>
<p class="sub">{nS} senadores y {nD} diputados · proyectos, asistencia, visitas y gasto de despacho · datos al {e(gen)}</p>
<div class="tools" id="tools" role="search">
<input id="f-q" type="search" placeholder="Buscar por nombre, bancada o distrito…  ( / )" aria-label="Buscar congresista" autocomplete="off">
<select id="f-cam" aria-label="Cámara"><option value="">Ambas cámaras</option><option value="S">Senado ({nS})</option><option value="D">Diputados ({nD})</option></select>
<select id="f-banc" aria-label="Bancada"><option value="">Todas las bancadas</option></select>
<select id="f-dist" aria-label="Distrito"><option value="">Todos los distritos</option></select>
<select id="f-ord" aria-label="Ordenar"><option value="nombre">Orden: nombre</option><option value="proy">Más proyectos</option><option value="asis">Mayor asistencia</option><option value="vis">Más visitas</option><option value="masa">Mayor planilla de despacho</option></select>
</div>
<div class="count" id="count" aria-live="polite">{len(todos)} congresistas</div>
<div class="grid" id="grid" style="margin-top:12px">{cards}</div>
<div class="empty" id="empty" hidden>Ningún congresista coincide con la búsqueda.</div>
<nav class="pager" id="pager" aria-label="Paginación"></nav>"""
    idx = pagina("Diputados y senadores del Perú 2026–2031: proyectos, asistencia y gasto | Congreso Abierto Perú",
                 f"Busca a los {len(bic['congresistas'])} congresistas del Perú (Senado y Cámara de Diputados 2026–2031): proyectos de ley, asistencia al Pleno, visitas y gasto de despacho con datos oficiales.",
                 "congresistas/", cuerpo,
                 [{"@context": "https://schema.org", "@type": "CollectionPage", "name": "Congresistas del Perú 2026–2031", "url": BASE + "congresistas/"}],
                 profundidad=1, seccion="cong", script=INDICE_JS)
    open(os.path.join(WEB, "congresistas", "index.html"), "w", encoding="utf-8").write(idx)

    # Bancadas
    cuerpo = '<h1>Producción legislativa por bancada</h1><p class="sub">Proyectos por grupo parlamentario con el filtro oficial de la API del Congreso.</p>'
    for cam in ("D", "S"):
        C = bic["camaras"][cam]
        filas = "".join(f'<tr><td>{e(b["bancada"])}</td><td class="num">{b.get("miembros") or "—"}</td><td class="num">{b["proyectos"]}</td>'
                        f'<td class="num">{b["por_miembro"] if b.get("por_miembro") is not None else "—"}</td><td class="num">{b.get("pct_desarrollo", "—")}%</td></tr>' for b in C.get("bancadas", []))
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
        "bancadas.html", cuerpo, seccion="banc"))

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
            "proveedores.html", cuerpo, seccion="prov"))

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
