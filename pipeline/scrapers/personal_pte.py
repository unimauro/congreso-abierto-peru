"""Scraper de la planilla del Congreso desde el Portal de Transparencia Estándar (PTE).

Fuente oficial: transparencia.gob.pe · el Congreso es `id_entidad=16`.
Trae la planilla nominal COMPLETA por régimen laboral (CAS, 276, 728, PAC, FAG,
Altos Funcionarios, Ley Servir…) con nombre, cargo, dependencia y remuneración real.

Hallazgo útil para fiscalización: en el régimen CAS, la columna "Dependencia"
suele traer el NOMBRE de un congresista (APELLIDOS, NOMBRES) → son asesores de
despacho asignados a ese congresista.

⚠️ Geobloqueo: el PTE responde bien desde IP residencial peruana; las IPs de
datacenter (GitHub Actions) suelen fallar. Por eso este scraper corre desde la
laptop (patrón `actualizar_personal.sh`), no en CI.

Uso:
    python -m pipeline.scrapers.personal_pte --anio 2026 --mes 6 --out data
    python -m pipeline.scrapers.personal_pte --auto --out data   # detecta último mes
"""
from __future__ import annotations

import argparse
import csv
import html
import os
import re
import sys
import time
import urllib.request

BASE = "https://www.transparencia.gob.pe/personal/pte_transparencia_personal.aspx"
ID_ENTIDAD = 16  # Congreso de la República en el PTE
ID_TEMA = 32
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")

# value del <select> de régimen -> etiqueta legible
REGIMENES = {
    1: "CAS",
    2: "Régimen 276",
    3: "Régimen 728",
    4: "PAC",
    5: "FAG",
    6: "PNUD",
    7: "Altos Funcionarios",
    8: "Pensionistas",
    9: "Ley Servir",
}

CAMPOS = ["regimen", "nombre", "cargo", "dependencia", "remuneracion", "total",
          "anio", "mes"]


def _get(url: str, timeout: int = 40, reintentos: int = 3) -> str:
    last = None
    for i in range(reintentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"GET falló tras {reintentos} intentos: {url} — {last}")


def _monto(s: str) -> float:
    """'S/ 10,199.19' -> 10199.19"""
    s = re.sub(r"[^\d.]", "", (s or "").replace(",", ""))
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _filas(pagina_html: str) -> list[list[str]]:
    """Extrae las filas de datos (10 celdas: régimen, nombre, cargo, dep, 5 montos, total)."""
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", pagina_html, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        # una fila de datos tiene >=6 celdas y al menos un monto 'S/'
        if len(cells) >= 6 and any("S/" in c for c in cells):
            out.append(cells)
    return out


def _tiene_datos(pagina_html: str) -> bool:
    return len(_filas(pagina_html)) > 0


def scrape_regimen(anio: int, mes: int, regimen: int, pausa: float = 0.6) -> list[dict]:
    """Descarga todas las páginas de un régimen para un año/mes dado."""
    registros: list[dict] = []
    pag = 1
    max_pag = 400  # backstop
    while pag <= max_pag:
        url = (f"{BASE}?id_entidad={ID_ENTIDAD}&in_anno_consulta={anio}"
               f"&ch_mes_consulta={mes:02d}&ch_tipo_regimen={regimen}"
               f"&id_tema={ID_TEMA}&pag={pag}")
        h = _get(url)
        filas = _filas(h)
        if not filas:
            break
        for c in filas:
            registros.append({
                "regimen": REGIMENES.get(regimen, str(regimen)),
                "nombre": c[1],
                "cargo": c[2],
                "dependencia": c[3],
                "remuneracion": _monto(c[4]),
                "total": _monto(c[-1]),
                "anio": anio,
                "mes": mes,
            })
        hay_siguiente = ("Siguiente" in h) or bool(re.search(rf"pag={pag + 1}\b", h))
        if not hay_siguiente:
            break
        pag += 1
        time.sleep(pausa)
    return registros


def detectar_ultimo_mes(anio_inicio: int, mes_inicio: int) -> tuple[int, int]:
    """Retrocede mes a mes (régimen CAS) hasta encontrar el más reciente con datos."""
    anio, mes = anio_inicio, mes_inicio
    for _ in range(18):  # hasta 18 meses atrás
        url = (f"{BASE}?id_entidad={ID_ENTIDAD}&in_anno_consulta={anio}"
               f"&ch_mes_consulta={mes:02d}&ch_tipo_regimen=1&id_tema={ID_TEMA}&pag=1")
        try:
            if _tiene_datos(_get(url)):
                return anio, mes
        except Exception:  # noqa: BLE001
            pass
        mes -= 1
        if mes == 0:
            mes = 12
            anio -= 1
    raise RuntimeError("No se encontró ningún mes con datos en los últimos 18 meses")


def scrape(anio: int, mes: int) -> list[dict]:
    todos: list[dict] = []
    for reg in REGIMENES:
        print(f"[*] régimen {reg} ({REGIMENES[reg]}) {anio}-{mes:02d}...", file=sys.stderr)
        try:
            regs = scrape_regimen(anio, mes, reg)
        except Exception as e:  # noqa: BLE001
            print(f"    ⚠ error régimen {reg}: {e}", file=sys.stderr)
            regs = []
        print(f"    {len(regs)} registros", file=sys.stderr)
        todos.extend(regs)
    return todos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--anio", type=int, default=None)
    ap.add_argument("--mes", type=int, default=None)
    ap.add_argument("--auto", action="store_true",
                    help="Detecta automáticamente el último mes con datos")
    ap.add_argument("--desde-anio", type=int, default=2026,
                    help="Año desde donde retroceder si --auto")
    ap.add_argument("--desde-mes", type=int, default=None,
                    help="Mes desde donde retroceder si --auto (default: diciembre)")
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    if args.auto or args.anio is None or args.mes is None:
        di, dm = args.desde_anio, (args.desde_mes or 12)
        print(f"[*] detectando último mes con datos desde {di}-{dm:02d}...", file=sys.stderr)
        anio, mes = detectar_ultimo_mes(di, dm)
        print(f"[*] último mes con datos: {anio}-{mes:02d}", file=sys.stderr)
    else:
        anio, mes = args.anio, args.mes

    registros = scrape(anio, mes)
    os.makedirs(args.out, exist_ok=True)
    ruta = os.path.join(args.out, "personal_congreso.csv")
    with open(ruta, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS)
        w.writeheader()
        w.writerows(registros)
    print(f"[ok] {ruta} — {len(registros)} registros ({anio}-{mes:02d})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
