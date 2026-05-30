"""Carga (upsert) de proyectos de ley en PostgreSQL.

Lee el JSON producido por `pipeline.scrapers.proyectos_ley` y hace upsert
idempotente por (periodo, numero), más sus autores.

Uso:
    export DATABASE_URL=postgresql://congreso:congreso@localhost:5432/congreso_abierto
    python -m pipeline.etl.load_proyectos data/proyectos_ley_2021.json

Requiere psycopg2-binary (ver pipeline/requirements.txt).
"""
from __future__ import annotations

import json
import os
import sys


def load(path: str, dsn: str | None = None) -> int:
    import psycopg2  # import diferido: solo necesario para cargar a BD

    dsn = dsn or os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("Define DATABASE_URL o pasa el DSN.")

    with open(path, encoding="utf-8") as f:
        proyectos = json.load(f)

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    n = 0
    try:
        with conn.cursor() as cur:
            for p in proyectos:
                cur.execute(
                    """
                    INSERT INTO proyectos_ley
                        (periodo, numero, codigo, estado, fecha_presentacion,
                         titulo, proponente, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, now())
                    ON CONFLICT (periodo, numero) DO UPDATE SET
                        estado = EXCLUDED.estado,
                        titulo = EXCLUDED.titulo,
                        proponente = EXCLUDED.proponente,
                        updated_at = now()
                    RETURNING id
                    """,
                    (p["periodo"], p["numero"], p["codigo"], p["estado"],
                     p["fecha_presentacion"] or None, p["titulo"], p["proponente"]),
                )
                proyecto_id = cur.fetchone()[0]
                for orden, autor in enumerate(p.get("autores", [])):
                    cur.execute(
                        """
                        INSERT INTO proyecto_autores (proyecto_id, nombre_raw, orden)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (proyecto_id, nombre_raw) DO NOTHING
                        """,
                        (proyecto_id, autor, orden),
                    )
                n += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return n


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    total = 0
    for path in sys.argv[1:]:
        c = load(path)
        print(f"[ok] {path}: {c} proyectos upsertados")
        total += c
    print(f"[ok] Total: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
