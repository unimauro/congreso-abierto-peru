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
from pipeline.scrapers.proyectos_ley import fetch_periodo, LISTA_ENDPOINT, _filtro, API_BASE  # noqa: E402
from pipeline.common.http import build_session  # noqa: E402

COMISIONES_ENDPOINT = f"{API_BASE}/comisiones"

# Estados que indican que el proyecto llegó a ser ley.
ESTADOS_LEY = ("PUBLICAD", "PROMULGAD", "AUTÓGRAFA", "AUTOGRAFA")


def es_ley(estado: str) -> bool:
    e = (estado or "").upper()
    return any(k in e for k in ESTADOS_LEY)


# Clasificador de materia por palabras clave en el título (orden = prioridad).
# Pensado para responder "¿qué tipo de leyes se están creando?" con honestidad:
# la primera categoría que coincide gana. "Declarativas" va primero porque es el
# hallazgo de fiscalización clave (leyes simbólicas: declara de interés, homenajes).
MATERIAS = [
    ("Declarativa / simbólica", ("DECLARA DE INTERES", "DECLARA DE INTERÉS",
        "DECLARA DE NECESIDAD", "DECLÁRESE", "DECLARESE", "DÍA NACIONAL", "DIA NACIONAL",
        "HOMENAJE", "HÉROE", "HEROE", "BENEMÉRIT", "DECLARA COMO", "DECLARA CIUDAD",
        "PATRIMONIO CULTURAL", "DENOMINA", "DÍA DE", "SEMANA DE")),
    ("Seguridad y orden", ("SEGURIDAD CIUDADANA", "DELINCUENC", "EXTORSI", "CRIMEN",
        "CRIMINAL", "SICARIA", "SERENAZGO", "ARMAS", "TERRORISMO", "ORDEN INTERNO",
        "MARCAJE", "PANDILLA")),
    ("Justicia y penal", ("PENAL", "DELITO", "PENA PRIVATIVA", "PRISIÓN", "PRISION",
        "JUDICIAL", "PROCESAL", "FISCALÍA", "FISCALIA", "MINISTERIO PÚBLICO",
        "IMPUNIDAD", "CORRUPCIÓN", "CORRUPCION")),
    ("Trabajo y pensiones", ("LABORAL", "TRABAJADOR", "REMUNERAC", "JORNADA",
        "SINDICA", "CTS", "GRATIFICAC", "JUBILAC", "PENSIONISTA", "AFP", "ONP",
        "SEGURO SOCIAL", "DESPIDO")),
    ("Salud", ("SALUD", "HOSPITAL", "ESSALUD", "MÉDIC", "MEDIC", "ENFERMED",
        "SANITARI", "FARMAC", "VACUNA", "DISCAPACIDAD")),
    ("Educación", ("EDUCAC", "ESCOLAR", "UNIVERSID", "DOCENTE", "ESTUDIANTE",
        "MAGISTERIAL", "PRONABEC", "ANALFABET", "INSTITUTO", "SUNEDU")),
    ("Economía y tributación", ("TRIBUT", "IMPUESTO", "IGV", "ARANCEL", "ECONÓMIC",
        "ECONOMIC", "FINANCIER", "CRÉDITO", "CREDITO", "MYPE", "EMPRESA", "MERCADO",
        "INVERSIÓN", "INVERSION", "REACTIVA")),
    ("Transporte e infraestructura", ("TRANSPORTE", "VEHÍCUL", "VEHICUL", "CARRETERA",
        "VIAL", "TRÁNSITO", "TRANSITO", "INFRAESTRUCTURA", "PEAJE", "AEROPUERTO",
        "PORTUARI")),
    ("Agrario, pesca y rural", ("AGRARI", "AGRÍCOL", "AGRICOL", "AGRO", "RURAL",
        "RIEGO", "GANADER", "PESCA", "PESQUER", "CAMÉLID", "CAFÉ", "CACAO")),
    ("Ambiente y recursos", ("AMBIENT", "FORESTAL", "AGUA", "MINER", "CONTAMINAC",
        "RESIDUOS", "CLIMÁTIC", "CLIMATIC", "ÁREA NATURAL", "ECOSISTEMA", "HÍDRIC",
        "HIDRIC")),
    ("Mujer, familia y niñez", ("MUJER", "FAMILIA", "VIOLENCIA", "NIÑO", "NIÑEZ",
        "NIÑA", "ADOLESCENT", "GÉNERO", "GENERO", "FEMINICID", "ALIMENT",
        "ADULTO MAYOR")),
    ("Descentralización y regiones", ("REGIONAL", "MUNICIPAL", "DISTRITO",
        "PROVINCIA", "DESCENTRALIZ", "GOBIERNO LOCAL", "MANCOMUNIDAD", "UBICACIÓN",
        "CREACIÓN DEL DISTRITO", "CREACION DEL DISTRITO")),
    ("Reforma política y electoral", ("ELECTORAL", "CONSTITUC", "REFORMA POLÍTICA",
        "PARTIDO POLÍTICO", "PARTIDO POLITICO", "REFERÉNDUM", "REFERENDUM",
        "BICAMERAL", "INMUNIDAD", "CONGRESO DE LA REP", "VOTO")),
]


def clasificar_materia(titulo: str) -> str:
    t = (titulo or "").upper()
    for nombre, claves in MATERIAS:
        if any(k in t for k in claves):
            return nombre
    return "Otros"


def fetch_comisiones(session, periodo: int) -> list[dict]:
    """Lista las comisiones y cuenta los proyectos asignados a cada una (dato real)."""
    resp = session.get(COMISIONES_ENDPOINT, timeout=getattr(session, "request_timeout", 60))
    resp.raise_for_status()
    comisiones = (resp.json().get("data") or [])
    salida = []
    for c in comisiones:
        body = _filtro(periodo)
        body["comisionId"] = c["comisionId"]
        r = session.post(
            LISTA_ENDPOINT,
            params={"pageSize": 100000, "page": 1, "rowStart": 0},
            json=body,
            timeout=getattr(session, "request_timeout", 60),
        )
        r.raise_for_status()
        n = len((r.json().get("data") or {}).get("proyectos") or [])
        salida.append({"nombre": c["nombreComision"], "proyectos": n})
        print(f"    comision {c['comisionId']:>2} {c['nombreComision'][:30]:<30} {n}", file=sys.stderr)
    salida.sort(key=lambda x: x["proyectos"], reverse=True)
    return salida


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
    principal = Counter()
    for p in todos:
        for a in p.autores:
            autores[a] += 1
        if p.autores:
            principal[p.autores[0]] += 1  # el primer firmante es el autor principal

    tot_con_autor = sum(principal.values())
    top10 = sum(c for _, c in principal.most_common(10))
    top20 = sum(c for _, c in principal.most_common(20))

    leyes = sum(1 for p in todos if es_ley(p.estado))

    print("[*] cruzando comisiones...", file=sys.stderr)
    comisiones = fetch_comisiones(session, periodos[0])

    # Materia por título + cuántas de cada materia llegaron a ser ley.
    materia_total = Counter()
    materia_leyes = Counter()
    for p in todos:
        mat = clasificar_materia(p.titulo)
        materia_total[mat] += 1
        if es_ley(p.estado):
            materia_leyes[mat] += 1
    materias = [
        {"tema": t, "proyectos": n, "leyes": materia_leyes.get(t, 0),
         "pct": round(n / len(todos) * 100, 1) if todos else 0}
        for t, n in materia_total.most_common()
    ]

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
        "comisiones": comisiones,
        "materias": materias,
        "produccion_congresistas": [
            {"nombre": n, "proyectos": c} for n, c in principal.most_common(20)
        ],
        "concentracion": {
            "autores_principales": len(principal),
            "total_con_autor": tot_con_autor,
            "top10_pct": round(top10 / tot_con_autor * 100, 1) if tot_con_autor else 0,
            "top20_pct": round(top20 / tot_con_autor * 100, 1) if tot_con_autor else 0,
        },
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
