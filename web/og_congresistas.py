"""Imagen para compartir (Open Graph, 1200×630) de cada congresista → web/og/<slug>.png.

Foto oficial (perfiles.json) incrustada en un SVG con nombre, cámara, bancada, distrito y 4 cifras
(proyectos, asistencia, visitas, planilla del despacho), convertido a PNG con rsvg-convert.
Corre en CI antes de web/build_seo.py (que apunta og:image a og/<slug>.png si existe).

    python web/og_congresistas.py            # requiere rsvg-convert (librsvg2-bin)
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.common.http import build_session  # noqa: E402

WEB = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(WEB, "og")
FONT = "Inter,Helvetica,Arial,sans-serif"
COLOR = {"FP": "#f97316", "JP": "#ef4444", "RP": "#0ea5e9", "AN": "#22c55e", "PBG": "#a855f7", "PCO": "#06b6d4",
         "APP": "#3b82f6", "PP": "#ec4899", "SP": "#eab308"}


def cargar(n):
    try:
        return json.load(open(os.path.join(WEB, n), encoding="utf-8"))
    except FileNotFoundError:
        return {}


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def esc(s) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def lineas(texto: str, ancho: int) -> list[str]:
    out, cur = [], ""
    for w in texto.split():
        if len(cur) + len(w) + 1 > ancho and cur:
            out.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    return out + ([cur] if cur else [])


def svg(m: dict, foto_b64: str | None, mime: str, pl: dict | None, vi: dict | None, dp: dict | None, presid: str | None) -> str:
    ap, _, nom = m["nombre"].partition(",")
    nombre = f"{nom.strip()} {ap.strip()}".strip()
    camara = "SENADO DEL PERÚ" if m["camara"] == "S" else "CÁMARA DE DIPUTADOS"
    col = COLOR.get(m.get("sigla"), "#94a3b8")
    ls = lineas(nombre, 20)[:3]
    fs = 60 if len(ls) <= 2 else 50
    y0 = 200
    nombre_svg = "".join(f'<text x="500" y="{y0 + i * (fs + 6)}" fill="#fff" font-size="{fs}" font-weight="800" font-family="{FONT}" letter-spacing="-1">{esc(t)}</text>'
                         for i, t in enumerate(ls))
    yb = y0 + (len(ls) - 1) * (fs + 6) + 52
    banc = esc(m.get("bancada") or "—")
    chip_w = 34 + len(m.get("bancada") or "—") * 13.5
    dist = esc(m.get("distrito") or "")
    asis = pl.get("pct_asistencia") if pl else None
    stats = [(str(m.get("principal", 0)), "proyectos"), (f"{asis:.0f}%" if asis is not None else "—", "asistencia"),
             (f"{vi['total']:,}" if vi else "—", "visitas"), (f"S/{dp['masa'] / 1000:.0f}k" if dp else "—", "despacho/mes")]
    cells = "".join(f'<text x="{500 + i * 170}" y="532" fill="#fff" font-size="44" font-weight="800" font-family="{FONT}">{esc(v)}</text>'
                    f'<text x="{500 + i * 170}" y="562" fill="#9aa1ad" font-size="21" font-family="{FONT}">{esc(l)}</text>' for i, (v, l) in enumerate(stats))
    if foto_b64:
        img = (f'<image href="data:{mime};base64,{foto_b64}" x="60" y="95" width="380" height="440" preserveAspectRatio="xMidYMin slice" clip-path="url(#cp)"/>'
               f'<rect x="60" y="95" width="380" height="440" rx="32" fill="none" stroke="{col}" stroke-width="4"/>')
    else:
        ini = "".join(p[0] for p in nombre.split()[:1] + nombre.split()[-1:]).upper()
        img = (f'<rect x="60" y="95" width="380" height="440" rx="32" fill="#1c1e24" stroke="{col}" stroke-width="4"/>'
               f'<text x="250" y="350" fill="#9aa1ad" font-size="120" font-weight="800" text-anchor="middle" font-family="{FONT}">{esc(ini)}</text>')
    extra = (f'<text x="500" y="{yb + 52}" fill="#facc15" font-size="22" font-weight="700" font-family="{FONT}">★ {esc(presid)}</text>' if presid else "")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0b0d"/><stop offset="1" stop-color="#17181e"/></linearGradient>
<radialGradient id="glow" cx="0.2" cy="0.3" r="0.6"><stop offset="0" stop-color="{col}" stop-opacity="0.28"/><stop offset="1" stop-color="{col}" stop-opacity="0"/></radialGradient>
<clipPath id="cp"><rect x="60" y="95" width="380" height="440" rx="32"/></clipPath></defs>
<rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#glow)"/>
<rect width="1200" height="8" fill="#e23744"/>
{img}
<text x="500" y="125" fill="{col}" font-size="22" font-weight="800" letter-spacing="3" font-family="{FONT}">{camara} · 2026–2031</text>
{nombre_svg}
<rect x="500" y="{yb - 30}" width="{chip_w:.0f}" height="42" rx="21" fill="{col}" fill-opacity="0.18" stroke="{col}"/>
<circle cx="{522}" cy="{yb - 9}" r="7" fill="{col}"/>
<text x="{538}" y="{yb}" fill="#fff" font-size="22" font-weight="700" font-family="{FONT}">{banc}</text>
<text x="{500 + chip_w + 18:.0f}" y="{yb}" fill="#c4c9d2" font-size="24" font-family="{FONT}">{dist}</text>
{extra}
<line x1="500" y1="470" x2="1140" y2="470" stroke="#2a2d36" stroke-width="2"/>
{cells}
<rect x="60" y="575" width="30" height="30" rx="8" fill="#e23744"/><text x="75" y="596" fill="#fff" font-size="14" font-weight="800" text-anchor="middle" font-family="{FONT}">CA</text>
<text x="102" y="597" fill="#c4c9d2" font-size="20" font-weight="700" font-family="{FONT}">Congreso Abierto Perú</text>
<text x="1140" y="597" fill="#6b7280" font-size="18" text-anchor="end" font-family="{FONT}">datos oficiales · unimauro.github.io/congreso-abierto-peru</text>
</svg>'''


def main() -> int:
    if not shutil.which("rsvg-convert"):
        print("[!] falta rsvg-convert; no se generan imágenes OG por congresista", file=sys.stderr)
        return 0
    bic = cargar("bicameral.json")
    if not bic:
        return 0
    os.makedirs(OUT, exist_ok=True)
    pl = {(x["camara"], x["nombre"]): x for x in cargar("plenos.json").get("miembros", [])}
    vi = {(x["camara"], x["nombre"]): x for x in cargar("visitas.json").get("congresistas", [])}
    dp = {(x["camara"], x["nombre"]): x for x in cargar("movimientos.json").get("despachos", [])}
    pf = {(x["camara"], x["nombre"]): x for x in cargar("perfiles.json").get("perfiles", [])}
    s = build_session(timeout=30)

    def uno(m):
        k = (m["camara"], m["nombre"])
        p = pf.get(k) or {}
        b64, mime = None, "image/png"
        if p.get("foto"):
            try:
                r = s.get(p["foto"], timeout=30)
                if r.ok and r.content:
                    b64 = base64.b64encode(r.content).decode()
                    mime = r.headers.get("content-type", "image/png").split(";")[0]
            except Exception:
                pass
        presid = next((f'{c["cargo"]} · {re.sub(r"^Comisi[oó]n (de |Bicameral de )?", "", c["organo"])}'
                       for c in p.get("comisiones", []) if re.match(r"(Presid|Vicepres)", c["cargo"])), None)
        if presid and len(presid) > 52:
            presid = presid[:50].rstrip() + "…"
        doc = svg(m, b64, mime, pl.get(k), vi.get(k), dp.get(k), presid)
        sl = slug(m["nombre"])
        png = os.path.join(OUT, f"{sl}.png")
        r = subprocess.run(["rsvg-convert", "-w", "1200", "-h", "630", "-o", png], input=doc.encode(), capture_output=True)
        if r.returncode != 0:
            return False
        try:  # JPG ~80 KB: WhatsApp y otras redes descartan previews pesadas
            from PIL import Image
            Image.open(png).convert("RGB").save(os.path.join(OUT, f"{sl}.jpg"), "JPEG", quality=84, optimize=True, progressive=True)
            os.remove(png)
        except Exception:
            pass
        return True

    with ThreadPoolExecutor(6) as ex:
        ok = sum(ex.map(uno, bic["congresistas"]))
    print(f"[ok] {ok}/{len(bic['congresistas'])} imágenes OG en {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
