"""Genera web/data.json con agregados reales de proyectos de ley para el dashboard.

Descarga uno o más periodos vía el scraper y precomputa estadísticas compactas
(el navegador no puede llamar la API del Congreso por CORS, así que servimos un
snapshot estático). Re-ejecutar este script = actualizar el dashboard.

    python web/build_data.py --periodos 2021 2016 --fecha 2026-05-29
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.scrapers.proyectos_ley import fetch_periodo  # noqa: E402
from pipeline.common.http import build_session  # noqa: E402

# Estados que indican que el proyecto llegó a ser ley.
ESTADOS_LEY = ("PUBLICAD", "PROMULGAD", "AUTÓGRAFA", "AUTOGRAFA")


def es_ley(estado: str) -> bool:
    e = (estado or "").upper()
    return any(k in e for k in ESTADOS_LEY)


def build(periodos: list[int], fecha: str) -> dict:
    session = build_session(timeout=120)
    todos = []
    por_periodo = {}
    for per in periodos:
        print(f"[*] {per}...", file=sys.stderr)
        proyectos = fetch_periodo(session, per)
        por_periodo[str(per)] = len(proyectos)
        todos.extend(proyectos)
        print(f"    {len(proyectos)}", file=sys.stderr)

    por_estado = Counter(p.estado for p in todos)
    por_anio = Counter(
        (p.fecha_presentacion or "")[:4] for p in todos if p.fecha_presentacion
    )
    por_proponente = Counter(p.proponente for p in todos if p.proponente)

    autores = Counter()
    for p in todos:
        for a in p.autores:
            autores[a] += 1

    leyes = sum(1 for p in todos if es_ley(p.estado))

    recientes = sorted(
        todos, key=lambda p: (p.fecha_presentacion or "", p.numero), reverse=True
    )[:25]

    return {
        "meta": {
            "generado": fecha,
            "periodos": periodos,
            "fuente": "api.congreso.gob.pe/spley-portal-service",
        },
        "totales": {
            "proyectos": len(todos),
            "leyes_aprobadas": leyes,
            "autores_unicos": len(autores),
            "por_periodo": por_periodo,
        },
        "por_estado": dict(por_estado.most_common(12)),
        "por_anio": dict(sorted(por_anio.items())),
        "por_proponente": dict(por_proponente.most_common(8)),
        "top_autores": [
            {"nombre": n, "proyectos": c} for n, c in autores.most_common(20)
        ],
        "recientes": [
            {
                "codigo": p.codigo,
                "estado": p.estado,
                "fecha": p.fecha_presentacion,
                "titulo": p.titulo,
                "autores": len(p.autores),
            }
            for p in recientes
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--periodos", nargs="+", type=int, default=[2021])
    ap.add_argument("--fecha", required=True, help="Fecha de generación YYYY-MM-DD")
    args = ap.parse_args()

    data = build(args.periodos, args.fecha)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"[ok] {out} — {data['totales']['proyectos']} proyectos", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
