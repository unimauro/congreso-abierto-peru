"""PDF descargable de cada ficha de congresista → web/pdf/<slug>.pdf.

Imprime con Chromium (Playwright) la ficha estática ya generada por web/build_seo.py, usando su
hoja de estilos de impresión (@media print: A4, tema claro, listas completas sin scroll).
Corre en CI después de build_seo.py. Si falta Playwright, no hace nada: el botón
"Descargar PDF" de la ficha cae a la impresión del navegador (Guardar como PDF).

    pip install playwright && python -m playwright install --with-deps chromium-headless-shell
    python web/pdf_congresistas.py [slug ...]
"""
from __future__ import annotations

import glob
import os
import sys

WEB = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(WEB, "pdf")


def main(argv: list[str]) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[!] falta playwright; no se generan PDFs", file=sys.stderr)
        return 0
    fichas = sorted(f for f in glob.glob(os.path.join(WEB, "congresistas", "*.html")) if not f.endswith("index.html"))
    if argv:
        fichas = [f for f in fichas if os.path.basename(f)[:-5] in argv]
    os.makedirs(OUT, exist_ok=True)
    ok = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context()
        pg = ctx.new_page()
        for f in fichas:
            slug = os.path.basename(f)[:-5]
            try:
                pg.goto("file://" + f, wait_until="networkidle", timeout=45000)
            except Exception:
                pass  # foto o fuente lenta: imprime igual con lo cargado
            try:
                pg.emulate_media(media="print")
                pg.pdf(path=os.path.join(OUT, f"{slug}.pdf"), format="A4", print_background=True,
                       display_header_footer=True, header_template="<span></span>",
                       footer_template='<div style="font-size:8px;color:#888;width:100%;text-align:center">'
                                       'Congreso Abierto Perú · datos oficiales · página <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
                       margin={"top": "12mm", "bottom": "14mm", "left": "11mm", "right": "11mm"})
                ok += 1
            except Exception as ex:
                print(f"[!] {slug}: {ex}", file=sys.stderr)
        b.close()
    print(f"[ok] {ok}/{len(fichas)} PDFs en {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
