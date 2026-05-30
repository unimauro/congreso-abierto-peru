"""Scraper de presupuesto del Congreso desde MEF Consulta Amigable.

La Consulta Amigable (apps5.mineco.gob.pe) está detrás de un WAF (Incapsula) y
navega por drill-down con postbacks ASP.NET + AJAX dentro de un frameset. Por eso
se usa un navegador real (Playwright + Chrome) que ejecuta JS y atraviesa el WAF.

Drill: Año → "Nivel de Gobierno" → fila "GOBIERNO NACIONAL" → "Sector"
       → fila "28: CONGRESO DE LA REPUBLICA" → PIA / PIM / Devengado / Avance%.

Requiere: pip install playwright  (usa Chrome del sistema con channel="chrome").

Uso:
    python -m pipeline.scrapers.presupuesto_mef --desde 2016 --hasta 2026 --out data/
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

BASE = "https://apps5.mineco.gob.pe/transparencia/Navegador/"
PLIEGO_CONGRESO = "CONGRESO DE LA REPUBLICA"
COLUMNAS = ["pia", "pim", "certificacion", "compromiso", "atencion_mensual",
            "devengado", "girado", "avance"]


def _wait_loaded(fr, must=None, timeout=30):
    """Espera a que el AJAX termine ('Cargando...' desaparezca) y, opcional, a un texto."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            t = fr.inner_text("body")
            if "Cargando..." not in t and (must is None or must in t.upper()):
                return t
        except Exception:
            pass
        time.sleep(0.6)
    return fr.inner_text("body")


def _frame(pg):
    return pg.frame(name="frame0") or pg.frames[-1]


def _parse_row(text: str) -> dict | None:
    """De 'NN: CONGRESO ... 1,412,401,268 ... 89.0' extrae las 8 columnas."""
    nums = re.findall(r"[\d.,]+", text.split("REPUBLICA")[-1])
    # Montos con separador de miles (coma) -> enteros; avance con punto decimal.
    vals = []
    for n in nums:
        n = n.strip(" .,")
        if not n:
            continue
        vals.append(n)
    if len(vals) < 8:
        return None
    montos = [int(v.replace(",", "")) for v in vals[:7]]
    avance = float(vals[7].replace(",", "."))
    out = dict(zip(COLUMNAS[:7], montos))
    out["avance"] = avance
    return out


def fetch_year(pg, year: int) -> dict | None:
    pg.goto(f"{BASE}default.aspx?y={year}&ap=ActProy", wait_until="networkidle", timeout=60000)
    fr = _frame(pg)
    fr.click("input[value='Nivel de Gobierno']")
    time.sleep(3)
    fr = _frame(pg); _wait_loaded(fr, "NACIONAL")
    fr.click("tr[onclick*='tr_clk']:has-text('GOBIERNO NACIONAL')")
    time.sleep(3)
    fr = _frame(pg); _wait_loaded(fr)
    fr.click("input[value='Sector']")
    time.sleep(3)
    fr = _frame(pg); _wait_loaded(fr, "CONGRESO")
    rows = fr.eval_on_selector_all(
        "tr[onclick*='tr_clk']",
        "trs=>trs.map(t=>t.innerText.replace(/\\s+/g,' ').trim()).filter(x=>/CONGRESO DE LA REPUBLICA/i.test(x))",
    )
    if not rows:
        return None
    parsed = _parse_row(rows[0])
    if parsed:
        parsed["anio"] = year
    return parsed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", type=int, default=2016)
    ap.add_argument("--hasta", type=int, default=2026)
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    serie = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        pg = browser.new_page()
        for year in range(args.desde, args.hasta + 1):
            try:
                row = fetch_year(pg, year)
                if row:
                    serie.append(row)
                    print(f"[ok] {year}: PIA S/{row['pia']:,} · Devengado S/{row['devengado']:,} · {row['avance']}%",
                          file=sys.stderr)
                else:
                    print(f"[!] {year}: sin datos del pliego Congreso", file=sys.stderr)
            except Exception as e:
                print(f"[err] {year}: {e}", file=sys.stderr)
        browser.close()

    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "presupuesto_congreso.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(serie, f, ensure_ascii=False, indent=2)
    print(f"[ok] {len(serie)} años -> {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
