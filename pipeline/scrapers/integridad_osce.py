"""Cruce de integridad de los proveedores del Congreso → web/integridad.json.

Fuentes (datos abiertos del OSCE/OECE, Plataforma Nacional de Datos Abiertos, actualización semanal):
  - sancionados.csv             inhabilitaciones del Tribunal de Contrataciones (vigentes e históricas)
  - sancionados_multa.csv       multas del Tribunal
  - penalidades.csv             penalidades aplicadas por entidades
  - Socios / representantes / organos.csv   personas detrás de cada RUC inscrito en el RNP

Cruces:
  1. Proveedor del Congreso (web/contratos.json) con sanción del Tribunal; se marca si el Congreso
     le adjudicó o firmó contrato MIENTRAS la inhabilitación estaba vigente.
  2. Socio, representante o directivo de un proveedor del Congreso cuyo nombre coincide EXACTAMENTE
     con alguien de la planilla del Congreso (web/personal.json) o con un congresista
     (web/bicameral.json). Es coincidencia de nombre, no identidad: puede ser un homónimo.

El RNSSC (sanciones a servidores civiles) de datos abiertos viene anonimizado y con la entidad
"SERVIR" en todas las filas, así que no se puede cruzar con la planilla.

    python -m pipeline.scrapers.integridad_osce
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from pipeline.common.http import build_session  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(RAIZ, "web")
CACHE = os.path.join(RAIZ, "data", "integridad")
OUT = os.path.join(WEB, "integridad.json")
WIKI = "https://osce-gob-pe.atlassian.net/wiki/rest/api/content/106889269/child/attachment"
ARCHIVOS = ("sancionados.csv", "sancionados_multa.csv", "penalidades.csv",
            "Socios.csv", "representantes.csv", "organos.csv")
FUENTE = "https://www.datosabiertos.gob.pe/dataset/proveedores-sancionados-con-inhabilitaci%C3%B3n-vigente-organismo-especializado-para-las"

csv.field_size_limit(10_000_000)


def descargar() -> None:
    os.makedirs(CACHE, exist_ok=True)
    s = build_session(timeout=300)
    adj = s.get(WIKI, params={"limit": 50, "expand": "version"}, timeout=60).json()["results"]
    links = {a["title"]: a["_links"]["download"] for a in adj}
    # Fecha de cada archivo: socios/representantes/penalidades no se actualizan desde 2021.
    json.dump({a["title"]: a["version"]["when"][:10] for a in adj},
              open(os.path.join(CACHE, "versiones.json"), "w"), indent=1)
    base = WIKI.split("/rest/")[0]
    for nombre in ARCHIVOS:
        if nombre not in links:
            print(f"[!] falta {nombre} en la wiki del OSCE", file=sys.stderr)
            continue
        r = s.get(base + links[nombre], timeout=600)
        r.raise_for_status()
        open(os.path.join(CACHE, nombre), "wb").write(r.content)
        print(f"    {nombre}: {len(r.content) // 1024} KB", file=sys.stderr)


def leer(nombre: str):
    raw = open(os.path.join(CACHE, nombre), "rb").read()
    try:
        txt = raw.decode("utf-8")
    except UnicodeDecodeError:
        txt = raw.decode("cp1252", errors="replace")
    return csv.DictReader(io.StringIO(txt), delimiter="|")


def clave(nombre: str) -> tuple:
    """Nombre como multiconjunto de palabras: 'PEREZ GOMEZ, ANA' == 'ANA PEREZ GOMEZ'."""
    s = unicodedata.normalize("NFKD", (nombre or "").upper()).encode("ascii", "ignore").decode()
    return tuple(sorted(re.sub(r"[^A-Z ]", " ", s).split()))


def iso(d: str) -> str | None:
    d = (d or "").strip()
    if re.fullmatch(r"\d{8}", d):
        return f"{d[:4]}-{d[4:6]}-{d[6:]}"
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", d)
    return f"{m[3]}-{m[2]}-{m[1]}" if m else None


def monto(x: str) -> float:
    x = (x or "").strip().replace(" ", "")
    if "," in x and "." not in x:
        x = x.replace(",", ".")  # coma decimal
    try:
        return float(x.replace(",", "")) if x else 0.0
    except ValueError:
        return 0.0


def limpio(t: str) -> str:
    t = re.sub(r"^[a-z]\)\s*", "", (t or "").strip())
    return t.split("*")[0].strip()


def build() -> dict:
    con = json.load(open(os.path.join(WEB, "contratos.json"), encoding="utf-8"))
    procesos = [p for p in con["procesos"] if p.get("rucs")]
    por_ruc = defaultdict(list)
    for p in procesos:
        for r in p["rucs"]:
            por_ruc[r].append(p)
    rucs = set(por_ruc)
    nombre_ruc = con.get("nombres", {})

    # 1) Sanciones de proveedores del Congreso
    sanciones = defaultdict(list)
    for r in leer("sancionados.csv"):
        if r["RUC"] in rucs:
            sanciones[r["RUC"]].append({"tipo": "inhabilitación", "inicio": iso(r["FECHA_INICIO"]), "fin": iso(r["FECHA_FIN"]),
                                        "resolucion": r["NUMERO_RESOLUCION"], "motivo": limpio(r["DE_MOTIVO_INFRACCION"])})
    for r in leer("sancionados_multa.csv"):
        if r["RUC"] in rucs:
            sanciones[r["RUC"]].append({"tipo": "multa", "inicio": iso(r["FECHA_INICIO"]), "fin": iso(r["FECHA_FIN"]),
                                        "resolucion": r["NUMERO_RESOLUCION"], "motivo": limpio(r["DE_MOTIVO_INFRACCION"]),
                                        "monto": monto(r["MONTO"])})
    penalidades = defaultdict(list)
    for r in leer("penalidades.csv"):
        if r["RUC CONTRATISTA"] in rucs:
            penalidades[r["RUC CONTRATISTA"]].append({"entidad": r["ENTIDAD CONTRATANTE"], "fecha": iso(r["FECHA PENALIDAD"]),
                                                     "motivo": r["DESCRIPCION/MOTIVO"], "monto": monto(r["MONTO"])})

    hoy = date.today().isoformat()
    proveedores = []
    for ruc in sorted(set(sanciones) | set(penalidades)):
        ps = por_ruc[ruc]
        durante = []
        for p in ps:
            f = p.get("adjudicado") or p.get("firmado")
            for s in sanciones[ruc]:
                if s["tipo"] == "inhabilitación" and f and s["inicio"] and s["inicio"] <= f <= (s["fin"] or "9999"):
                    durante.append({"ocid": p["ocid"], "objeto": p["objeto"], "fecha": f, "monto": p["monto"], "resolucion": s["resolucion"]})
        proveedores.append({
            "ruc": ruc, "nombre": nombre_ruc.get(ruc, ""),
            "procesos_congreso": len(ps), "monto_congreso": round(sum(p["monto"] or 0 for p in ps), 2),
            "vigente": any(s["tipo"] == "inhabilitación" and s["inicio"] and s["inicio"] <= hoy <= (s["fin"] or "9999")
                           for s in sanciones[ruc]),
            "sanciones": sorted(sanciones[ruc], key=lambda s: s["inicio"] or "", reverse=True),
            "penalidades": penalidades[ruc],
            "durante_sancion": durante,
        })
    proveedores.sort(key=lambda x: (-len(x["durante_sancion"]), not x["vigente"], -x["monto_congreso"]))

    # 2) Personas detrás de los proveedores ↔ planilla y congresistas
    personal = json.load(open(os.path.join(WEB, "personal.json"), encoding="utf-8"))
    planilla = defaultdict(list)
    for r in personal["lista"]:
        if r[2] != "Pensionistas":
            planilla[clave(r[0])].append({"cargo": r[1], "dependencia": r[3]})
    congresistas = {clave(m["nombre"]): m for m in json.load(open(os.path.join(WEB, "bicameral.json"), encoding="utf-8"))["congresistas"]}

    vinculos = []
    for archivo, rol, campo_nombre, campo_cargo in (("Socios.csv", "socio", "Nombre_o_RazonSocial", None),
                                                    ("representantes.csv", "representante", "Nombre_RazonSocial", None),
                                                    ("organos.csv", "órgano de administración", "Nombre_RazonSocial", "Cargo")):
        for r in leer(archivo):
            if r["Ruc_Proveedor"] not in rucs or "RUC" in (r.get("Tipo_Documento") or "").upper():
                continue
            k = clave(r[campo_nombre])
            if len(k) < 3:  # nombres demasiado cortos dan homónimos
                continue
            base = {"persona": r[campo_nombre].strip(), "rol": rol + (f" ({r[campo_cargo].strip().lower()})" if campo_cargo and r.get(campo_cargo) else ""),
                    "ruc": r["Ruc_Proveedor"], "proveedor": nombre_ruc.get(r["Ruc_Proveedor"], ""),
                    "monto_congreso": round(sum(p["monto"] or 0 for p in por_ruc[r["Ruc_Proveedor"]]), 2)}
            if k in congresistas:
                m = congresistas[k]
                vinculos.append({**base, "en_congreso": f"Congresista ({m.get('sigla', '')}, {'Senado' if m['camara'] == 'S' else 'Diputados'})"})
            for x in planilla.get(k, []):
                vinculos.append({**base, "en_congreso": f"{x['cargo'].title()} · {x['dependencia'].title()}"})
    # sin duplicados (una persona puede figurar como socio y representante del mismo RUC)
    vistos, unicos = set(), []
    for v in vinculos:
        k = (v["persona"], v["ruc"], v["rol"], v["en_congreso"])
        if k not in vistos:
            vistos.add(k)
            unicos.append(v)

    try:
        versiones = json.load(open(os.path.join(CACHE, "versiones.json")))
    except FileNotFoundError:
        versiones = {}
    return {
        "meta": {
            "generado": hoy,
            "fechas": {k: versiones.get(k) for k in ARCHIVOS},
            "fuente": "OECE · datos abiertos: proveedores sancionados (inhabilitación y multa), penalidades, socios, "
                      "representantes y órganos de administración del RNP",
            "url": FUENTE,
            "nota": "Las coincidencias de personas son por nombre completo exacto (sin DNI en la planilla): "
                    "pueden ser homónimos y deben verificarse. Una sanción pasada no impide contratar una vez cumplida.",
        },
        "totales": {
            "proveedores_revisados": len(rucs),
            "con_sancion": sum(1 for p in proveedores if p["sanciones"]),
            "vigentes": sum(1 for p in proveedores if p["vigente"]),
            "contratados_durante_sancion": sum(1 for p in proveedores if p["durante_sancion"]),
            "con_penalidades": sum(1 for p in proveedores if p["penalidades"]),
            "vinculos": len(unicos),
        },
        "proveedores": proveedores,
        "vinculos": unicos,
    }


def main() -> int:
    if "--sin-descarga" not in sys.argv:
        descargar()
    data = build()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"[ok] {OUT} — {data['totales']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
