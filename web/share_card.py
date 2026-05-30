"""Genera una tarjeta compartible (SVG) con los datos clave del observatorio.

Lee web/data.json y emite web/share.svg (1080x1350, formato vertical WhatsApp).
Convertir a PNG:  rsvg-convert -w 1080 web/share.svg -o web/share.png
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main() -> None:
    d = json.load(open(os.path.join(HERE, "data.json"), encoding="utf-8"))
    t = d["totales"]
    tasa = t["leyes_aprobadas"] / t["proyectos"] * 100
    fecha = d["meta"]["generado"]

    def fmt(n):  # 14704 -> 14,704
        return f"{n:,}"

    # Top 4 estados para mini-barras
    estados = list(d["por_estado"].items())[:4]
    maxv = max(v for _, v in estados) if estados else 1
    top_autor = d["top_autores"][0]

    W, H = 1080, 1350
    bars = ""
    y0 = 1012
    for i, (name, val) in enumerate(estados):
        y = y0 + i * 64
        bw = int(560 * val / maxv)
        label = esc(name if len(name) <= 28 else name[:27] + "…")
        bars += f'''
    <text x="80" y="{y-8}" fill="#c7ccd6" font-size="22" font-family="Helvetica,Arial">{label}</text>
    <rect x="80" y="{y+2}" width="600" height="26" rx="13" fill="#1d2026"/>
    <rect x="80" y="{y+2}" width="{bw}" height="26" rx="13" fill="#3b82f6"/>
    <text x="700" y="{y+22}" fill="#e7e9ee" font-size="22" font-weight="700" font-family="Helvetica,Arial">{fmt(val)}</text>'''

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0b0d"/><stop offset="1" stop-color="#14151a"/>
    </linearGradient>
    <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e23744"/><stop offset="1" stop-color="#b3121d"/>
    </linearGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="{W}" height="10" fill="url(#logo)"/>

  <!-- Header -->
  <rect x="80" y="90" width="74" height="74" rx="18" fill="url(#logo)"/>
  <text x="117" y="142" fill="#fff" font-size="36" font-weight="800" font-family="Helvetica,Arial" text-anchor="middle">CA</text>
  <text x="178" y="128" fill="#e7e9ee" font-size="40" font-weight="800" font-family="Helvetica,Arial">Congreso Abierto Perú</text>
  <text x="178" y="160" fill="#9aa1ad" font-size="24" font-family="Helvetica,Arial">Observatorio legislativo · datos oficiales</text>

  <!-- Title -->
  <text x="80" y="270" fill="#e7e9ee" font-size="58" font-weight="800" font-family="Helvetica,Arial">¿Qué hizo el</text>
  <text x="80" y="338" fill="#e7e9ee" font-size="58" font-weight="800" font-family="Helvetica,Arial">Congreso 2021–2026?</text>

  <!-- KPI grande 1 -->
  <text x="80" y="500" fill="#e23744" font-size="120" font-weight="800" font-family="Helvetica,Arial">{fmt(t['proyectos'])}</text>
  <text x="80" y="548" fill="#c7ccd6" font-size="30" font-family="Helvetica,Arial">proyectos de ley presentados</text>

  <!-- KPI fila -->
  <text x="80" y="690" fill="#22c55e" font-size="76" font-weight="800" font-family="Helvetica,Arial">{fmt(t['leyes_aprobadas'])}</text>
  <text x="80" y="730" fill="#9aa1ad" font-size="26" font-family="Helvetica,Arial">leyes publicadas</text>

  <text x="560" y="690" fill="#3b82f6" font-size="76" font-weight="800" font-family="Helvetica,Arial">{tasa:.0f}%</text>
  <text x="560" y="730" fill="#9aa1ad" font-size="26" font-family="Helvetica,Arial">tasa de aprobación</text>

  <text x="80" y="850" fill="#f59e0b" font-size="76" font-weight="800" font-family="Helvetica,Arial">{fmt(t['autores_unicos'])}</text>
  <text x="80" y="890" fill="#9aa1ad" font-size="26" font-family="Helvetica,Arial">congresistas autores</text>

  <text x="560" y="850" fill="#a855f7" font-size="50" font-weight="800" font-family="Helvetica,Arial">{esc(top_autor['nombre'].split(',')[0])}</text>
  <text x="560" y="890" fill="#9aa1ad" font-size="26" font-family="Helvetica,Arial">+ proyectos firmados ({top_autor['proyectos']})</text>

  <!-- Estados -->
  <text x="80" y="975" fill="#e7e9ee" font-size="30" font-weight="700" font-family="Helvetica,Arial">¿En qué etapa están?</text>
  {bars}

  <!-- Footer -->
  <line x1="80" y1="1235" x2="1000" y2="1235" stroke="#23262e" stroke-width="2"/>
  <text x="80" y="1285" fill="#e7e9ee" font-size="30" font-weight="700" font-family="Helvetica,Arial">unimauro.github.io/congreso-abierto-peru</text>
  <text x="80" y="1320" fill="#6b7280" font-size="22" font-family="Helvetica,Arial">Fuente: api.congreso.gob.pe · actualizado {fecha} · datos públicos</text>
</svg>'''

    out = os.path.join(HERE, "share.svg")
    with open(out, "w", encoding="utf-8") as f:
        f.write(svg)
    print(out)


if __name__ == "__main__":
    main()
