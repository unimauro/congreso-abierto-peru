"""Genera web/personal.json con agregados reales de la planilla del Congreso (PTE).

Lee data/personal_congreso.csv (producido por
`pipeline/scrapers/personal_pte.py`, id_entidad=16 del Portal de Transparencia)
y precomputa estadísticas compactas para el dashboard estático.

Separa la PLANILLA ACTIVA (CAS + 276 + 728 + Servir + Altos Funcionarios) de los
PENSIONISTAS (cesantes, viudez, ex-presidentes) porque son costos de naturaleza
distinta y mezclarlos distorsiona el "costo del Congreso".

    python web/build_personal.py --fecha 2026-08-15
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import sys
from collections import Counter, defaultdict

CSV_IN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "data", "personal_congreso.csv")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "personal.json")

PENSION = {"Pensionistas"}
# Rangos de sueldo para la distribución (soles mensuales).
BUCKETS = [(0, 2500), (2500, 5000), (5000, 8000), (8000, 12000),
           (12000, 18000), (18000, 10**9)]
BUCKET_LBL = ["< 2.5k", "2.5k–5k", "5k–8k", "8k–12k", "12k–18k", "> 18k"]


def _rows():
    # tolerante a bytes NUL que a veces mete el scraping del PTE
    with open(CSV_IN, encoding="utf-8", errors="ignore") as f:
        yield from csv.DictReader(l.replace("\x00", "") for l in f)


def bucket(monto: float) -> str:
    for (lo, hi), lbl in zip(BUCKETS, BUCKET_LBL):
        if lo <= monto < hi:
            return lbl
    return BUCKET_LBL[-1]


def build(fecha: str) -> dict:
    rows = list(_rows())
    if not rows:
        raise SystemExit("data/personal_congreso.csv vacío — corre el scraper primero")

    anio = rows[0]["anio"]
    mes = rows[0]["mes"]

    activos = [r for r in rows if r["regimen"] not in PENSION]
    pensionistas = [r for r in rows if r["regimen"] in PENSION]

    def monto(r):
        try:
            return float(r["total"])
        except (TypeError, ValueError):
            return 0.0

    sueldos_act = [monto(r) for r in activos if monto(r) > 0]
    masa_act = sum(sueldos_act)
    masa_pen = sum(monto(r) for r in pensionistas)

    por_regimen = Counter()
    masa_regimen = defaultdict(float)
    for r in rows:
        por_regimen[r["regimen"]] += 1
        masa_regimen[r["regimen"]] += monto(r)

    por_cargo = Counter(r["cargo"] for r in activos if r["cargo"])
    por_dep = Counter(r["dependencia"] for r in activos if r["dependencia"])

    dist = Counter(bucket(s) for s in sueldos_act)

    top_sueldos = sorted(activos, key=monto, reverse=True)[:20]
    top_pensiones = sorted(pensionistas, key=monto, reverse=True)[:12]

    return {
        "meta": {
            "generado": fecha,
            "anio": int(anio),
            "mes": int(mes),
            "fuente": "transparencia.gob.pe (PTE) · id_entidad=16",
            "regimenes": sorted(set(r["regimen"] for r in rows)),
            "nota": ("Planilla nominal del Portal de Transparencia Estándar. "
                     "Los pensionistas (cesantes, viudez, ex-presidentes) se "
                     "reportan aparte de la planilla activa."),
        },
        "totales": {
            "planilla_activa": len(activos),
            "pensionistas": len(pensionistas),
            "registros": len(rows),
            "masa_mensual_activa": round(masa_act, 2),
            "masa_anual_activa_est": round(masa_act * 14, 2),  # 12 + 2 gratificaciones
            "masa_mensual_pensiones": round(masa_pen, 2),
        },
        "sueldos": {
            "mediana": round(statistics.median(sueldos_act), 2) if sueldos_act else 0,
            "promedio": round(statistics.mean(sueldos_act), 2) if sueldos_act else 0,
            "min": round(min(sueldos_act), 2) if sueldos_act else 0,
            "max": round(max(sueldos_act), 2) if sueldos_act else 0,
            "distribucion": [{"rango": l, "n": dist.get(l, 0)} for l in BUCKET_LBL],
        },
        "por_regimen": [
            {"regimen": k, "n": v, "masa": round(masa_regimen[k], 2)}
            for k, v in por_regimen.most_common()
        ],
        "por_cargo": [{"cargo": k, "n": v} for k, v in por_cargo.most_common(15)],
        "por_dependencia": [{"dependencia": k, "n": v} for k, v in por_dep.most_common(15)],
        "top_sueldos": [
            {"nombre": r["nombre"], "cargo": r["cargo"], "regimen": r["regimen"],
             "dependencia": r["dependencia"], "total": monto(r)}
            for r in top_sueldos
        ],
        "top_pensiones": [
            {"nombre": r["nombre"], "cargo": r["cargo"], "total": monto(r)}
            for r in top_pensiones
        ],
        # Lista nominal COMPLETA (compacta) para el buscador del sitio.
        # Orden de campos: [nombre, cargo, régimen, dependencia, total].
        "lista_campos": ["nombre", "cargo", "regimen", "dependencia", "total"],
        "lista": [
            [r["nombre"], r["cargo"], r["regimen"], r["dependencia"], monto(r)]
            for r in sorted(rows, key=lambda r: r["nombre"])
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fecha", required=True, help="Fecha de generación YYYY-MM-DD")
    args = ap.parse_args()
    data = build(args.fecha)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    t = data["totales"]
    print(f"[ok] {OUT} — {t['planilla_activa']} activos + {t['pensionistas']} "
          f"pensionistas · masa S/{t['masa_mensual_activa']:,}/mes", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
