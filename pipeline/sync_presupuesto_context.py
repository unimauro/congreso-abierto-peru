#!/usr/bin/env python3
"""Sincroniza la serie de presupuesto de data/presupuesto_congreso.json
(soles exactos, scrapeado del MEF) hacia web/context.json (millones redondeados,
lo que lee el dashboard). Solo toca presupuesto.serie; el resto queda igual.

Uso: python3 pipeline/sync_presupuesto_context.py
Sale con código 0 siempre; imprime si hubo cambios o no.
"""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CRUDO = RAIZ / "data" / "presupuesto_congreso.json"
CONTEXT = RAIZ / "web" / "context.json"


def a_millones(soles: float) -> int:
    return round(soles / 1_000_000)


def main() -> None:
    crudo = json.loads(CRUDO.read_text(encoding="utf-8"))
    filas = crudo["serie"] if isinstance(crudo, dict) and "serie" in crudo else crudo

    serie = [
        {
            "anio": f["anio"],
            "pia": a_millones(f["pia"]),
            "pim": a_millones(f["pim"]),
            "devengado": a_millones(f["devengado"]),
            "avance": f["avance"],
        }
        for f in sorted(filas, key=lambda f: f["anio"])
    ]

    context = json.loads(CONTEXT.read_text(encoding="utf-8"))
    if context["presupuesto"]["serie"] == serie:
        print("[ok] context.json ya estaba al día (sin cambios)")
        return

    context["presupuesto"]["serie"] = serie
    CONTEXT.write_text(
        json.dumps(context, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[ok] context.json actualizado — {len(serie)} años, "
          f"último: {serie[-1]['anio']} devengado S/{serie[-1]['devengado']}M "
          f"({serie[-1]['avance']}%)")


if __name__ == "__main__":
    main()
