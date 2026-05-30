"""Genera la imagen OG (1200x630) para previews de WhatsApp/redes desde data.json + context.json."""
from __future__ import annotations
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))


def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    d = json.load(open(os.path.join(HERE, "data.json"), encoding="utf-8"))
    ctx = json.load(open(os.path.join(HERE, "context.json"), encoding="utf-8"))
    t = d["totales"]
    pia = ctx["presupuesto"]["serie"][-1]
    fmt = lambda n: f"{n:,}"

    stats = [
        (fmt(t["proyectos"]), "proyectos de ley", "#e23744"),
        (fmt(t["leyes_aprobadas"]), "leyes publicadas", "#22c55e"),
        (f"S/{fmt(pia['pia'])}M", f"presupuesto {pia['anio']}", "#3b82f6"),
        (fmt(t["autores_unicos"]), "autores", "#f59e0b"),
    ]
    cells = ""
    for i, (num, lab, col) in enumerate(stats):
        x = 70 + (i % 2) * 540
        y = 330 + (i // 2) * 150
        cells += f'''
    <text x="{x}" y="{y}" fill="{col}" font-size="74" font-weight="800" font-family="Helvetica,Arial">{num}</text>
    <text x="{x}" y="{y+38}" fill="#9aa1ad" font-size="27" font-family="Helvetica,Arial">{lab}</text>'''

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0b0d"/><stop offset="1" stop-color="#15161b"/></linearGradient>
    <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e23744"/><stop offset="1" stop-color="#b3121d"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="9" fill="url(#logo)"/>
  <rect x="70" y="70" width="84" height="84" rx="20" fill="url(#logo)"/>
  <text x="112" y="129" fill="#fff" font-size="42" font-weight="800" font-family="Helvetica,Arial" text-anchor="middle">CA</text>
  <text x="178" y="112" fill="#e7e9ee" font-size="46" font-weight="800" font-family="Helvetica,Arial">Congreso Abierto Perú</text>
  <text x="178" y="148" fill="#9aa1ad" font-size="26" font-family="Helvetica,Arial">Observatorio legislativo · datos oficiales</text>
  <text x="70" y="240" fill="#e7e9ee" font-size="50" font-weight="800" font-family="Helvetica,Arial">¿Qué hizo el Congreso 2021–2026?</text>
  {cells}
  <line x1="70" y1="560" x2="1130" y2="560" stroke="#23262e" stroke-width="2"/>
  <text x="70" y="600" fill="#9aa1ad" font-size="25" font-family="Helvetica,Arial">unimauro.github.io/congreso-abierto-peru</text>
</svg>'''
    with open(os.path.join(HERE, "og.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    print("og.svg")


if __name__ == "__main__":
    main()
