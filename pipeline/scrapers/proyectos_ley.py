"""Scraper de Proyectos de Ley del Congreso de la República del Perú.

Fuente verificada (2026-05-29):
    POST https://api.congreso.gob.pe/spley-portal-service/proyecto-ley/lista-con-filtro
    body: {"perParId": <periodo>, ...resto null}

Devuelve, por periodo parlamentario, el listado completo de proyectos de ley con
número, estado, fecha de presentación, título, proponente y autores.

Uso:
    python -m pipeline.scrapers.proyectos_ley --periodos 2021 2016 --out data/
    python -m pipeline.scrapers.proyectos_ley --periodos 2021 --limit 5   # vista rápida

Salida: un JSON (y opcionalmente CSV) por periodo en el directorio --out.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any

# Permite ejecutar como script suelto (`python pipeline/scrapers/proyectos_ley.py`)
# además de como módulo (`python -m pipeline.scrapers.proyectos_ley`).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pipeline.common.http import build_session  # noqa: E402

API_BASE = "https://api.congreso.gob.pe/spley-portal-service"
LISTA_ENDPOINT = f"{API_BASE}/proyecto-ley/lista-con-filtro"

# Periodos parlamentarios conocidos (perParId = año de inicio del periodo).
PERIODOS_CONOCIDOS = [2021, 2016, 2011, 2006]


@dataclass
class ProyectoLey:
    """Un proyecto de ley normalizado."""

    periodo: int
    numero: int
    codigo: str           # ej. "14704/2025-CR"
    estado: str
    fecha_presentacion: str | None
    titulo: str
    proponente: str
    autores: list[str]

    @classmethod
    def from_api(cls, row: dict[str, Any]) -> "ProyectoLey":
        autores_raw = (row.get("autores") or "").strip()
        autores = [a.strip() for a in autores_raw.split(";") if a.strip()]
        fecha = row.get("fecPresentacion")
        # La API entrega "2026-05-29T00:00:00.000-05:00"; nos quedamos con la fecha.
        fecha_iso = fecha.split("T")[0] if isinstance(fecha, str) and "T" in fecha else fecha
        return cls(
            periodo=int(row.get("perParId")),
            numero=int(row.get("pleyNum")),
            codigo=row.get("proyectoLey", ""),
            estado=row.get("desEstado", ""),
            fecha_presentacion=fecha_iso,
            titulo=(row.get("titulo") or "").strip(),
            proponente=(row.get("desProponente") or "").strip(),
            autores=autores,
        )


def _filtro(periodo: int) -> dict[str, Any]:
    """Body del POST. perParId es obligatorio; el resto va en null."""
    return {
        "perParId": periodo,
        "perLegId": None,
        "comisionId": None,
        "estadoId": None,
        "grupParId": None,
        "tipoFirmanteId": None,
        "congresistaId": None,
        "texto": None,
        "fechaPresentacion": None,
        "numeroProyecto": None,
    }


def fetch_periodo(session, periodo: int) -> list[ProyectoLey]:
    """Descarga todos los proyectos de ley de un periodo parlamentario."""
    params = {"pageSize": 100000, "page": 1, "rowStart": 0}
    resp = session.post(
        LISTA_ENDPOINT,
        params=params,
        json=_filtro(periodo),
        timeout=getattr(session, "request_timeout", 60),
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("code") != 200:
        raise RuntimeError(f"API code {payload.get('code')}: {payload.get('status')}")
    proyectos = (payload.get("data") or {}).get("proyectos") or []
    return [ProyectoLey.from_api(p) for p in proyectos]


def save(proyectos: list[ProyectoLey], periodo: int, out_dir: str) -> tuple[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, f"proyectos_ley_{periodo}.json")
    csv_path = os.path.join(out_dir, f"proyectos_ley_{periodo}.csv")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump([asdict(p) for p in proyectos], f, ensure_ascii=False, indent=2)

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["periodo", "numero", "codigo", "estado", "fecha_presentacion",
             "titulo", "proponente", "autores", "n_autores"]
        )
        for p in proyectos:
            writer.writerow([
                p.periodo, p.numero, p.codigo, p.estado, p.fecha_presentacion,
                p.titulo, p.proponente, " | ".join(p.autores), len(p.autores),
            ])
    return json_path, csv_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Scraper de Proyectos de Ley del Congreso del Perú")
    parser.add_argument("--periodos", nargs="+", type=int, default=[2021],
                        help=f"Periodos (perParId). Conocidos: {PERIODOS_CONOCIDOS}")
    parser.add_argument("--out", default="data", help="Directorio de salida")
    parser.add_argument("--limit", type=int, default=None,
                        help="Solo imprime los primeros N (vista rápida, no guarda)")
    args = parser.parse_args()

    session = build_session(timeout=120)
    total = 0
    for periodo in args.periodos:
        print(f"[*] Descargando proyectos de ley del periodo {periodo}...", file=sys.stderr)
        proyectos = fetch_periodo(session, periodo)
        total += len(proyectos)
        print(f"    -> {len(proyectos)} proyectos", file=sys.stderr)

        if args.limit:
            for p in proyectos[: args.limit]:
                print(f"  {p.codigo} [{p.estado}] {p.titulo[:70]}... ({len(p.autores)} autores)")
            continue

        json_path, csv_path = save(proyectos, periodo, args.out)
        print(f"    guardado: {json_path} / {csv_path}", file=sys.stderr)

    print(f"[ok] Total: {total} proyectos", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
