"""Genera web/movimientos.json: cómo se mueve el personal del Congreso mes a mes.

El PTE solo publica el último mes, así que la serie se arma con el historial de
git de web/personal.json (cada refresco versionó la planilla nominal completa).
Por cada par de meses consecutivos compara por nombre: altas, bajas, cambios de
dependencia y de cargo. Además atribuye el personal de cada despacho a su
congresista (en la planilla, la "dependencia" de un asesor es el nombre del
congresista) usando el padrón de web/bicameral.json.

Corre en la laptop junto con el refresco de personal (necesita el historial git).

    python web/build_movimientos.py --fecha 2026-10-26
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict

WEB = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(WEB)
OUT = os.path.join(WEB, "movimientos.json")
NOMBRE, CARGO, REGIMEN, DEPENDENCIA, TOTAL = range(5)


def tokens(s: str) -> list[str]:
    s = unicodedata.normalize("NFKD", (s or "").upper()).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z ]", " ", s).split()


def snapshots() -> dict[tuple[int, int], dict]:
    """{(anio, mes): personal.json} — el más reciente de cada mes, incluido el del disco."""
    commits = subprocess.run(["git", "log", "--format=%H", "--", "web/personal.json"],
                             cwd=RAIZ, capture_output=True, text=True, check=True).stdout.split()
    vistos: dict[tuple[int, int], dict] = {}
    actual = json.load(open(os.path.join(WEB, "personal.json"), encoding="utf-8"))
    vistos[(actual["meta"]["anio"], actual["meta"]["mes"])] = actual
    for c in commits:  # del más nuevo al más viejo: el primero de cada mes gana
        raw = subprocess.run(["git", "show", f"{c}:web/personal.json"], cwd=RAIZ,
                             capture_output=True, text=True).stdout
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        k = (d["meta"]["anio"], d["meta"]["mes"])
        if d.get("lista") and k not in vistos:
            vistos[k] = d
    return dict(sorted(vistos.items()))


def activos(d: dict) -> dict[str, list]:
    return {r[NOMBRE]: r for r in d["lista"] if r[REGIMEN] != "Pensionistas"}


def comparar(a: dict, b: dict) -> dict:
    A, B = activos(a), activos(b)
    altas = [B[n] for n in B.keys() - A.keys()]
    bajas = [A[n] for n in A.keys() - B.keys()]
    comunes = A.keys() & B.keys()
    dep = [(A[n], B[n]) for n in comunes if A[n][DEPENDENCIA] != B[n][DEPENDENCIA]]
    cargo = [(A[n], B[n]) for n in comunes if A[n][CARGO] != B[n][CARGO]]
    sube = [(A[n], B[n]) for n in comunes if A[n][TOTAL] > 0 and B[n][TOTAL] >= A[n][TOTAL] * 1.2]
    masa_a, masa_b = sum(r[TOTAL] for r in A.values()), sum(r[TOTAL] for r in B.values())

    def persona(r):
        return {"nombre": r[NOMBRE], "cargo": r[CARGO], "dependencia": r[DEPENDENCIA], "total": r[TOTAL]}

    return {
        "desde": f"{a['meta']['anio']}-{a['meta']['mes']:02d}", "hasta": f"{b['meta']['anio']}-{b['meta']['mes']:02d}",
        "activos_desde": len(A), "activos_hasta": len(B),
        "altas": len(altas), "bajas": len(bajas),
        "cambio_dependencia": len(dep), "cambio_cargo": len(cargo), "aumento_20pct": len(sube),
        "masa_desde": round(masa_a, 2), "masa_hasta": round(masa_b, 2),
        "altas_por_cargo": dict(Counter(r[CARGO] for r in altas).most_common(8)),
        "bajas_por_cargo": dict(Counter(r[CARGO] for r in bajas).most_common(8)),
        "top_altas": [persona(r) for r in sorted(altas, key=lambda r: -r[TOTAL])[:15]],
        "top_aumentos": [{**persona(y), "antes": x[TOTAL], "cargo_antes": x[CARGO]}
                         for x, y in sorted(sube, key=lambda p: -(p[1][TOTAL] - p[0][TOTAL]))[:15]],
    }


def despachos(d: dict, congresistas: list[dict], previo: dict | None) -> list[dict]:
    """Personal por despacho congresal: la dependencia contiene apellidos + un nombre del congresista."""
    claves = []
    for m in congresistas:
        ap, _, nom = m["nombre"].partition(",")
        claves.append((set(tokens(ap)), set(tokens(nom)), m))
    por_dep = defaultdict(list)
    for r in activos(d).values():
        por_dep[r[DEPENDENCIA]].append(r)
    antes = activos(previo) if previo else {}

    salida = []
    for dep, rs in por_dep.items():
        w = set(tokens(dep))
        hits = [m for ap, nom, m in claves if ap and ap <= w and nom & w]
        if len(hits) != 1:
            continue
        m = hits[0]
        salida.append({
            "nombre": m["nombre"], "camara": m["camara"], "sigla": m.get("sigla", "—"),
            "personal": len(rs), "masa": round(sum(r[TOTAL] for r in rs), 2),
            # ya estaba en la planilla el mes de comparación (p. ej. venía de otro despacho)
            "continuan": sum(1 for r in rs if r[NOMBRE] in antes),
            "equipo": [{"nombre": r[NOMBRE], "cargo": r[CARGO], "total": r[TOTAL],
                        "antes": antes[r[NOMBRE]][DEPENDENCIA] if r[NOMBRE] in antes else None}
                       for r in sorted(rs, key=lambda r: -r[TOTAL])],
        })
    return sorted(salida, key=lambda x: -x["masa"])


def bancadas(d: dict) -> list[dict]:
    """Personal asignado a cada grupo parlamentario (dependencia "GRUPO PARLAMENTARIO …")."""
    c = defaultdict(lambda: [0, 0.0])
    for r in activos(d).values():
        if r[DEPENDENCIA].startswith("GRUPO PARLAMENTARIO"):
            c[r[DEPENDENCIA].replace("GRUPO PARLAMENTARIO ", "").title()][0] += 1
            c[r[DEPENDENCIA].replace("GRUPO PARLAMENTARIO ", "").title()][1] += r[TOTAL]
    return sorted(({"grupo": k, "personal": n, "masa": round(m, 2)} for k, (n, m) in c.items()),
                  key=lambda x: -x["masa"])


def build(fecha: str) -> dict:
    snaps = snapshots()
    meses = list(snaps)
    congresistas = json.load(open(os.path.join(WEB, "bicameral.json"), encoding="utf-8"))["congresistas"]
    ultimo = snaps[meses[-1]]
    # Comparar los despachos contra el último mes del Congreso unicameral (julio 2026)
    # si existe; si no, contra el mes anterior disponible.
    ref = snaps.get((2026, 7)) if meses[-1] > (2026, 7) else None
    ref = ref or (snaps[meses[-2]] if len(meses) > 1 else None)
    return {
        "meta": {
            "generado": fecha,
            "meses": [f"{a}-{m:02d}" for a, m in meses],
            "referencia_despachos": f"{ref['meta']['anio']}-{ref['meta']['mes']:02d}" if ref else None,
            "fuente": "Planilla nominal PTE (id_entidad=16) · snapshots versionados en git",
            "nota": "Comparación por nombre completo entre meses publicados; solo planilla activa (sin pensionistas). "
                    "Los meses sin snapshot no se pueden reconstruir: el PTE solo expone el último.",
        },
        "serie": [{"mes": f"{a}-{m:02d}", "activos": len(activos(d)),
                   "masa": round(sum(r[TOTAL] for r in activos(d).values()), 2)} for (a, m), d in snaps.items()],
        "comparaciones": [comparar(snaps[x], snaps[y]) for x, y in zip(meses, meses[1:])],
        "despachos": despachos(ultimo, congresistas, ref),
        "bancadas": bancadas(ultimo),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fecha", required=True)
    args = ap.parse_args()
    data = build(args.fecha)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"[ok] {OUT} — {len(data['serie'])} meses · {len(data['despachos'])} despachos", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
