"""Participación de congresistas en empresas proveedoras del Estado → web/intereses.json.

Fuente: pipeline/data/intereses_verificados.json — solo vínculos corroborados por DNI por el OECE
(ficha del proveedor: conformación + cruce con el registro de funcionarios de la Contraloría),
estado SUNAT (padrón reducido) y contratos OCDS. Se revisa a mano; las "pistas" no verificadas
NO se incluyen. Nunca contiene DNI.

Señal de posible conflicto de interés (a revisar, no acusación): el rubro de la empresa coincide
con una comisión que integra el congresista o con proyectos que presentó. SUNAT no publica la
actividad económica en datos abiertos, así que el rubro se estima por el nombre de la empresa y
lo que vende al Estado según el RNP; se rotula como estimado.

    python web/build_intereses.py
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from datetime import date

WEB = os.path.dirname(os.path.abspath(__file__))
FUENTE = os.path.join(os.path.dirname(WEB), "pipeline", "data", "intereses_verificados.json")
OUT = os.path.join(WEB, "intereses.json")

# sector estimado → (patrones en nombre/objeto, palabras en comisiones, palabras en títulos de proyectos)
SECTORES = {
    "Agropecuario": (r"AGRICOL|AGRARI|AGRO|ORGANIC|GANAD", r"agrari|agricult|agropecuari|desarrollo productivo|produccion", r"agrari|agricol|agro|riego|productor|ganad|cafe|cacao|organic"),
    "Educación universitaria": (r"UNIVERSIDAD|INSTITUTO|EDUCA", r"educaci", r"universi|educacion superior|sunedu|instituto|educativ|docente"),
    "Construcción e inmobiliario": (r"CONSTRUC|INMOBILIAR|\bOBRA|EDIFIC|ejecutor de obra", r"vivienda|infraestructura|construcci", r"obra|construcci|vivienda|edificaci|saneamiento|infraestructura"),
    "Transporte y neumáticos": (r"NEUMATIC|TRANSPORT|AUTOMOTR|LLANTA", r"transport|infraestructura", r"transporte|vehicul|neumatic|automotor|carretera|vial"),
    "Fundaciones y cultura": (r"FUNDACION|ASOCIACION|CULTURA", r"cultura", r"fundaci|cultura|patrimonio"),
}


def norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def build() -> dict:
    regs = json.load(open(FUENTE, encoding="utf-8"))
    bic = json.load(open(os.path.join(WEB, "bicameral.json"), encoding="utf-8"))
    try:
        perf = {(p["camara"], p["nombre"]): p for p in json.load(open(os.path.join(WEB, "perfiles.json"), encoding="utf-8"))["perfiles"]}
    except FileNotFoundError:
        perf = {}
    cong = {(m["camara"], m["nombre"]): m for m in bic["congresistas"]}
    salida = []
    for r in regs:
        k = (r["camara"], r["congresista"])
        m = cong.get(k)
        if not m:
            continue
        texto_emp = (r["empresa"] or "") + " " + " ".join(r.get("objeto_rnp") or [])
        sectores = [s for s, (pat, _, _) in SECTORES.items() if re.search(pat, texto_emp, re.I)]
        coms = [c for c in (perf.get(k) or {}).get("comisiones", [])]
        senales = []
        if (r.get("estado_sunat") or "").upper() == "ACTIVO":
            for s in sectores:
                _, pc, pp = SECTORES[s]
                for c in coms:
                    if re.search(pc, norm(c["organo"])):
                        senales.append({"tipo": "comision", "sector": s, "detalle": f'{c["cargo"]} de la {c["organo"]}'})
                for p in m.get("proyectos") or []:
                    if re.search(pp, norm(p["titulo"])):
                        senales.append({"tipo": "proyecto", "sector": s, "detalle": f'{p["codigo"]}: {p["titulo"][:160]}', "codigo": p["codigo"]})
        salida.append({
            "congresista": r["congresista"], "camara": r["camara"], "sigla": m.get("sigla"),
            "empresa": r["empresa"], "ruc": r["ruc"], "rol": r["rol_actual"], "participacion_pct": r.get("participacion_pct"),
            "estado_sunat": r.get("estado_sunat"), "condicion_sunat": r.get("condicion_sunat"),
            "vende_al_estado": r.get("objeto_rnp") or [], "apto_para_contratar": r.get("apto_para_contratar_rnp"),
            "sector_estimado": sectores, "contratos_desde_mandato": r.get("contratos_estado_desde_mandato", 0),
            "contratos_previos": r.get("contratos_previos") or [], "ficha": r.get("fuente_ficha_publica"),
            "senales": senales[:8],
        })
    return {
        "meta": {"generado": date.today().isoformat(), "corte_fuente": max((r.get("fecha_corte") or "") for r in regs),
                 "fuente": "OECE: ficha del proveedor (conformación societaria y cruce con el registro de funcionarios de la Contraloría por DNI); "
                           "SUNAT: padrón reducido de RUC; contratos: OCDS/SEACE 2021-07 en adelante",
                 "nota": "Solo vínculos corroborados por DNI. Tener una empresa no es irregular; la ley impide a los congresistas contratar "
                         "con el Estado durante su mandato. Las señales de posible conflicto de interés son coincidencias de sector "
                         "(estimado por el nombre de la empresa y lo que vende al Estado) con sus comisiones o proyectos: requieren revisión."},
        "totales": {"vinculos": len(salida), "congresistas": len({(x["camara"], x["congresista"]) for x in salida}),
                    "activas": sum(1 for x in salida if (x["estado_sunat"] or "").upper() == "ACTIVO"),
                    "con_senales": len({(x["camara"], x["congresista"]) for x in salida if x["senales"]}),
                    "contratos_desde_mandato": sum(x["contratos_desde_mandato"] for x in salida)},
        "vinculos": salida,
    }


if __name__ == "__main__":
    d = build()
    json.dump(d, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[ok] {OUT} — {d['totales']}")
    for x in d["vinculos"]:
        if x["senales"]:
            print("  ", x["congresista"], "·", x["empresa"][:40], "→", [(s["tipo"], s["detalle"][:70]) for s in x["senales"]])
