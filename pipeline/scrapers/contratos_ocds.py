"""Contratos del Congreso desde Contrataciones Abiertas (OCDS) de la OECE → web/contratos.json.

Fuente: el bulk mensual en CSV de https://contratacionesabiertas.oece.gob.pe
(`/api/v1/file/seace_v3/csv/AAAA/MM/`), segmentado por mes de convocatoria. Cada zip trae
todo el Estado (~10 MB); solo se guarda lo del Congreso (comprador PE-CONSUCODE-6) en
data/contratos/AAAA-MM.json. Los meses recientes se vuelven a bajar en cada corrida porque
un proceso convocado en septiembre recién se adjudica y contrata semanas después.

Cobertura: procesos registrados en SEACE (licitaciones, concursos, subastas, comparaciones,
contrataciones directas...). Las compras menores a 8 UIT no pasan por SEACE y no aparecen.

    python -m pipeline.scrapers.contratos_ocds              # desde 2021-07, refresca 3 meses
    python -m pipeline.scrapers.contratos_ocds --refrescar 6
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from pipeline.common.http import build_session  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, "data", "contratos")
OUT = os.path.join(RAIZ, "web", "contratos.json")
URL = "https://contratacionesabiertas.oece.gob.pe/api/v1/file/seace_v3/csv/{a}/{m:02d}/"
COMPRADOR = "PE-CONSUCODE-6"  # CONGRESO DE LA REPUBLICA
INICIO = (2021, 7)
P = "compiledRelease/"

csv.field_size_limit(10_000_000)


def num(x: str) -> float | None:
    try:
        return float(x) if x not in ("", None) else None
    except ValueError:
        return None


def meses(desde: tuple[int, int], hasta: tuple[int, int]):
    a, m = desde
    while (a, m) <= hasta:
        yield a, m
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)


def leer(z: zipfile.ZipFile, nombre: str, ids: set[str] | None = None):
    cand = [n for n in z.namelist() if n.endswith("/" + nombre) or n == nombre]
    if not cand:
        return []
    with z.open(cand[0]) as f:
        rd = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))
        return [r for r in rd if ids is None or r.get("ocid") in ids]


def extraer_mes(session, a: int, m: int) -> list[dict]:
    r = session.get(URL.format(a=a, m=m), timeout=300)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    recs = {x["ocid"]: x for x in leer(z, "records.csv") if x.get(P + "buyer/id") == COMPRADOR}
    ids = set(recs)
    if not ids:
        return []
    awards, contratos = defaultdict(list), defaultdict(list)
    proveedores = defaultdict(list)
    for x in leer(z, "com_awa_suppliers.csv", ids):
        proveedores[x[P + "awards/0/id"]].append({
            "ruc": x[P + "awards/0/suppliers/0/id"].replace("PE-RUC-", ""),
            "nombre": x[P + "awards/0/suppliers/0/name"]})
    for x in leer(z, "com_awards.csv", ids):
        aid = x[P + "awards/0/id"]
        awards[x["ocid"]].append({"id": aid, "monto": num(x[P + "awards/0/value/amount"]),
                                  "moneda": x[P + "awards/0/value/currency"],
                                  "fecha": x[P + "awards/0/date"][:10], "proveedores": proveedores.get(aid, [])})
    for x in leer(z, "com_contracts.csv", ids):
        contratos[x["ocid"]].append({
            "id": x[P + "contracts/0/id"], "award": x[P + "contracts/0/awardID"],
            "numero": x[P + "contracts/0/title"], "descripcion": x[P + "contracts/0/description"],
            "monto": num(x[P + "contracts/0/value/amount"]), "moneda": x[P + "contracts/0/value/currency"],
            "firmado": x[P + "contracts/0/dateSigned"][:10],
            "inicio": x[P + "contracts/0/period/startDate"][:10], "fin": x[P + "contracts/0/period/endDate"][:10]})
    salida = []
    for ocid, x in recs.items():
        salida.append({
            "ocid": ocid, "mes": f"{a}-{m:02d}",
            "nomenclatura": x.get(P + "tender/title", ""), "objeto": x.get(P + "tender/description", ""),
            "metodo": x.get(P + "tender/procurementMethodDetails", ""),
            "categoria": x.get(P + "tender/mainProcurementCategory", ""),
            "valor_referencial": num(x.get(P + "tender/value/amount_PEN") or x.get(P + "tender/value/amount", "")),
            "convocado": x.get(P + "tender/datePublished", "")[:10],
            "postores": int(num(x.get(P + "tender/numberOfTenderers", "")) or 0) or None,
            "adjudicaciones": awards.get(ocid, []), "contratos": contratos.get(ocid, []),
        })
    return salida


def actualizar_cache(refrescar: int) -> None:
    os.makedirs(CACHE, exist_ok=True)
    hoy = date.today()
    todos = list(meses(INICIO, (hoy.year, hoy.month)))
    recientes = set(todos[-refrescar:])
    session = build_session(timeout=300)
    for a, m in todos:
        ruta = os.path.join(CACHE, f"{a}-{m:02d}.json")
        if os.path.exists(ruta) and (a, m) not in recientes:
            continue
        try:
            procesos = extraer_mes(session, a, m)
        except Exception as e:  # un mes caído no tumba la serie: se reintenta la próxima vez
            print(f"[!] {a}-{m:02d}: {e}", file=sys.stderr)
            continue
        json.dump(procesos, open(ruta, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"    {a}-{m:02d}: {len(procesos)} procesos del Congreso", file=sys.stderr)


def adjudicado(p: dict) -> float:
    """Monto del proceso: contratos firmados si hay; si no, lo adjudicado (en soles)."""
    c = [x["monto"] for x in p["contratos"] if x["monto"] and x["moneda"] in ("PEN", "")]
    if c:
        return sum(c)
    return sum(x["monto"] for x in p["adjudicaciones"] if x["monto"] and x["moneda"] in ("PEN", ""))


def build() -> dict:
    procesos = {}
    for f in sorted(os.listdir(CACHE)):
        if f.endswith(".json"):
            for p in json.load(open(os.path.join(CACHE, f), encoding="utf-8")):
                procesos[p["ocid"]] = p  # el mes más nuevo gana si un ocid aparece dos veces
    lista = sorted(procesos.values(), key=lambda p: p["convocado"] or p["mes"], reverse=True)

    prov = defaultdict(lambda: {"monto": 0.0, "procesos": 0, "nombre": ""})
    por_anio = defaultdict(lambda: {"procesos": 0, "monto": 0.0, "postor_unico": 0})
    metodos, categorias = Counter(), Counter()
    for p in lista:
        monto = adjudicado(p)
        p["monto"] = round(monto, 2)
        anio = (p["convocado"] or p["mes"])[:4]
        por_anio[anio]["procesos"] += 1
        por_anio[anio]["monto"] += monto
        if p["postores"] == 1 and monto:
            por_anio[anio]["postor_unico"] += 1
        metodos[p["metodo"] or "—"] += monto
        categorias[p["categoria"] or "—"] += monto
        # reparte el monto por proveedor según sus adjudicaciones
        for aw in p["adjudicaciones"]:
            firmado = sum(c["monto"] or 0 for c in p["contratos"] if c["award"] == aw["id"])
            m = firmado or aw["monto"] or 0
            for s in aw["proveedores"]:
                d = prov[s["ruc"]]
                d["nombre"] = s["nombre"]
                d["monto"] += m / len(aw["proveedores"])
                d["procesos"] += 1
    total = sum(d["monto"] for d in prov.values())
    proveedores = sorted(({"ruc": k, "nombre": v["nombre"], "monto": round(v["monto"], 2), "procesos": v["procesos"],
                           "pct": round(v["monto"] / total * 100, 2) if total else 0} for k, v in prov.items()),
                         key=lambda x: -x["monto"])
    adj = [p for p in lista if p["monto"]]
    return {
        "meta": {
            "generado": date.today().isoformat(),
            "fuente": "Contrataciones Abiertas OECE (OCDS, SEACE v3) · comprador Congreso de la República (PE-CONSUCODE-6)",
            "desde": f"{INICIO[0]}-{INICIO[1]:02d}",
            "nota": "Procesos registrados en SEACE por mes de convocatoria. Monto = contratos firmados o, si aún no hay, "
                    "lo adjudicado. No incluye compras menores a 8 UIT ni las de catálogo electrónico de Perú Compras, que no pasan por este registro; la mayor parte del presupuesto del Congreso es planilla.",
        },
        "totales": {
            "procesos": len(lista), "adjudicados": len(adj), "monto": round(total, 2),
            "proveedores": len(proveedores),
            "postor_unico": sum(1 for p in adj if p["postores"] == 1),
            "top10_pct": round(sum(x["pct"] for x in proveedores[:10]), 1),
        },
        "por_anio": {k: {**v, "monto": round(v["monto"], 2)} for k, v in sorted(por_anio.items())},
        "por_metodo": {k: round(v, 2) for k, v in metodos.most_common()},
        "por_categoria": {k: round(v, 2) for k, v in categorias.most_common()},
        "proveedores": proveedores[:100],
        "procesos": [{k: p[k] for k in ("ocid", "nomenclatura", "objeto", "metodo", "categoria", "valor_referencial",
                                       "convocado", "postores", "monto")} |
                     {"proveedores": sorted({s["nombre"] for aw in p["adjudicaciones"] for s in aw["proveedores"]})}
                     for p in lista],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refrescar", type=int, default=3, help="meses recientes a volver a bajar")
    ap.add_argument("--sin-descarga", action="store_true")
    args = ap.parse_args()
    if not args.sin_descarga:
        actualizar_cache(args.refrescar)
    data = build()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    t = data["totales"]
    print(f"[ok] {OUT} — {t['procesos']} procesos · S/ {t['monto']:,.0f} · {t['proveedores']} proveedores", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
