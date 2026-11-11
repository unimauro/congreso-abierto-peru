"""Trayectoria pública de los asesores de cada despacho → web/asesores.json.

Cruza el equipo de cada despacho (web/movimientos.json → despachos[].equipo[]) con
registros OFICIALES de otras entidades del Estado, descargados por el repo hermano
`peru-transparente` (no se scrapea nada aquí; solo se leen sus CSV):

  data/funcionarios_historico.csv  Portal de Transparencia Estándar (PTE), planillas 2015–2025
  data/funcionarios_v2.csv         PTE, planillas 2025–2026 (mensual)
  data/dj_intereses.csv            Contraloría: declaraciones juradas de intereses
  data/designaciones.csv           El Peruano: resoluciones de designación / nombramiento
  data/contratos.csv               OCDS/SEACE: buenas pro (solo proveedor persona natural)

Uso de `data/` (directorio de peru-transparente, solo lectura):
  - Se configura con la variable PT_DATA (por defecto ~/Repos/peru-transparente/data).
  - Si no existe o falta un CSV obligatorio, se sale con código 0 y se conserva el
    web/asesores.json anterior (la corrida diaria no falla por esto).
  - Los CSV grandes (618 MB) se leen en streaming con el módulo csv: nunca se cargan enteros.
  - NO se usan: sanciones RNSSC ni órdenes de servicio (traen DNI). Ningún DNI ni RUC
    llega al JSON publicado (el RUC 10 de una persona natural contiene su DNI).

Reglas de cruce (publicabilidad):
  - Nombre normalizado como conjunto de tokens (sin tildes, mayúsculas, sin DE/LA/DEL/LOS/LAS/Y);
    se exige coincidencia EXACTA del conjunto y ≥3 tokens.
  - Nombres de 3 tokens con algún apellido entre los 40 más frecuentes de la planilla del
    Congreso (web/personal.json) requieren una segunda señal: misma familia de cargo, o que
    la entidad/área del registro coincida con la dependencia previa ('antes') del asesor.
    Sin segunda señal, el registro se omite.
  - Se excluye al propio Congreso de la República (esa trayectoria ya está en el sitio).
  - Si el mismo nombre figura el mismo mes en planillas de dos entidades distintas
    (homónimos probables), el asesor se marca `ambiguo: true` en vez de descartarse.
  - Planillas PTE: meses/años consecutivos en la misma entidad+cargo se colapsan en un rango.
  - Solo se publican asesores con ≥1 registro; máximo 12 registros cada uno, lo más reciente primero.

    python -m pipeline.scrapers.asesores_historial
    PT_DATA=/ruta/a/data python -m pipeline.scrapers.asesores_historial
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(RAIZ, "web")
OUT = os.path.join(WEB, "asesores.json")
PT_DATA = os.path.expanduser(os.environ.get("PT_DATA", "~/Repos/peru-transparente/data"))

MAX_ITEMS = 12
TOP_APELLIDOS = 40
GAP_MESES = 13  # el histórico PTE es ~1 corte por año: años seguidos cuentan como continuos
STOP = {"DE", "LA", "DEL", "LOS", "LAS", "Y"}
SUELDO_MIN = 1025  # filas menores (propinas, prácticas, ajustes) no cuentan para homónimos

csv.field_size_limit(10**9)

# Familias de cargo para la "segunda señal".
FAMILIAS = [
    ("directivo", ("DIRECTOR", "JEFE", "GERENTE", "SUBGERENTE", "VICEMINISTR", "MINISTR", "PRESIDENT",
                   "ALCALDE", "REGIDOR", "SECRETARIO GENERAL", "INTENDENTE", "SUPERINTENDENTE", "PROCURADOR")),
    ("asesor", ("ASESOR", "CONSULTOR", "ESPECIALISTA", "PROFESIONAL", "ANALISTA", "COORDINADOR",
                "ABOGADO", "ECONOMISTA", "INGENIERO", "CONTADOR", "COMUNICADOR", "PERIODISTA")),
    ("apoyo", ("TECNICO", "ASISTENTE", "AUXILIAR", "SECRETARI", "APOYO", "OPERADOR", "CHOFER",
               "CONDUCTOR", "NOTIFICADOR", "DIGITADOR", "RECEPCIONISTA", "TRABAJADOR", "OBRERO")),
]
COMPATIBLES = {"directivo": {"directivo", "asesor"}, "asesor": {"asesor", "directivo"}, "apoyo": {"apoyo"}}


def plano(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper()


def tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^A-Z]+", plano(s)) if t and t not in STOP]


def clave(s: str) -> frozenset:
    return frozenset(tokens(s))


def familia(cargo: str) -> str | None:
    c = plano(cargo)
    for nom, kws in FAMILIAS:
        # al inicio de palabra: "ADMINISTRATIVO" no debe contar como "MINISTR(O)"
        if any(re.search(r"\b" + k, c) for k in kws):
            return nom
    return None


def es_congreso(entidad: str) -> bool:
    return "CONGRESO DE LA REPUBLICA" in plano(entidad)


def periodo(anio, mes) -> int | None:
    try:
        return int(anio) * 12 + int(mes) - 1
    except (TypeError, ValueError):
        return None


def ym(p: int) -> str:
    return f"{p // 12}-{p % 12 + 1:02d}"


# --------------------------------------------------------------------------- asesores
def cargar_asesores():
    mov = json.load(open(os.path.join(WEB, "movimientos.json"), encoding="utf-8"))
    pers = json.load(open(os.path.join(WEB, "personal.json"), encoding="utf-8"))
    ap = Counter()
    for fila in pers.get("lista", []):
        for t in tokens(str(fila[0]).split(",")[0]):
            ap[t] += 1
    comunes = {t for t, _ in ap.most_common(TOP_APELLIDOS)}

    asesores, por_clave = [], defaultdict(list)
    stats = Counter()
    for d in mov.get("despachos", []):
        for e in d.get("equipo") or []:
            stats["evaluados"] += 1
            k = clave(e["nombre"])
            a = {
                "nombre": e["nombre"], "despacho": d.get("nombre"), "camara": d.get("camara"),
                "cargo": e.get("cargo"), "antes": e.get("antes"), "clave": k,
                "apellidos": set(tokens(e["nombre"].split(",")[0])),
                "familia": familia(e.get("cargo") or ""),
            }
            if len(k) < 3:
                stats["omitidos_nombre_corto"] += 1
                continue
            a["estricto"] = len(k) == 3 and bool(a["apellidos"] & comunes)
            if a["estricto"]:
                stats["exigen_segunda_senal"] += 1
            asesores.append(a)
            por_clave[k].append(a)
    return asesores, por_clave, stats


def segunda_senal(a, entidad: str, cargo: str, area: str = "") -> bool:
    fa, fr = a["familia"], familia(cargo)
    if fa and fr and fr in COMPATIBLES.get(fa, ()):
        return True
    if a["antes"]:
        ta = set(tokens(a["antes"])) - {"OFICINA", "AREA", "DEPARTAMENTO", "DIRECCION", "GENERAL", "UNIDAD"}
        tr = set(tokens(entidad + " " + area))
        if len(ta & tr) >= 2:
            return True
    return False


# --------------------------------------------------------------------------- fuentes
def escanear_pte(path, por_clave, pte, cobertura, nombre_fuente):
    """Agrega por clave: {(entidad, cargo): [periodos], ...} y presencia mensual por entidad."""
    lo = hi = None
    filas = 0
    cache: dict[str, frozenset] = {}
    with open(path, encoding="utf-8", errors="ignore", newline="") as f:
        r = csv.reader(f)
        h = next(r)
        i = {c: h.index(c) for c in ("entidad", "anio", "mes", "regimen", "apellidos_nombres",
                                     "cargo", "dependencia", "total_ingreso_mensual")}
        for row in r:
            filas += 1
            try:
                p = periodo(row[i["anio"]], row[i["mes"]])
                nom = row[i["apellidos_nombres"]]
            except IndexError:
                continue
            if p is not None:
                lo = p if lo is None or p < lo else lo
                hi = p if hi is None or p > hi else hi
            k = cache.get(nom)
            if k is None:
                k = clave(nom)
                if len(cache) < 2_000_000:
                    cache[nom] = k
            if k not in por_clave or p is None:
                continue
            pte[k].append({
                "entidad": row[i["entidad"]].strip(), "cargo": row[i["cargo"]].strip(),
                "area": row[i["dependencia"]].strip(), "regimen": row[i["regimen"]].strip(),
                "p": p, "total": _num(row[i["total_ingreso_mensual"]]),
            })
    cobertura[nombre_fuente] = {"desde": ym(lo) if lo is not None else None,
                                "hasta": ym(hi) if hi is not None else None, "filas": filas}


def _num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def items_pte(a, filas):
    """Colapsa en rangos por entidad+cargo; detecta homónimos simultáneos."""
    ambiguo, otra_2026 = False, False
    por_mes = defaultdict(set)
    grupos = defaultdict(list)
    replicas = set()
    for x in filas:
        if es_congreso(x["entidad"]):
            continue
        # El Poder Judicial publica la misma planilla bajo cada Corte Superior: una fila idéntica
        # (mes, cargo, área, monto) en varias entidades es una sola persona-cargo.
        firma = (x["p"], plano(x["cargo"]), plano(x["area"]), round(x["total"]))
        if firma in replicas:
            continue
        replicas.add(firma)
        if a["estricto"] and not segunda_senal(a, x["entidad"], x["cargo"], x["area"]):
            continue
        if x["total"] >= SUELDO_MIN:
            por_mes[x["p"]].add(plano(x["entidad"]))
        if x["p"] >= periodo(2026, 8):  # meses en que el asesor ya figura en el Congreso bicameral
            otra_2026 = True
        grupos[(x["entidad"], x["cargo"])].append(x)
    if any(len(v) > 1 for v in por_mes.values()):
        ambiguo = True
    items = []
    for (ent, cargo), xs in grupos.items():
        xs.sort(key=lambda x: x["p"])
        ini = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x["p"] - prev["p"] <= GAP_MESES:
                prev = x
                continue
            det = " · ".join(t for t in (ini["regimen"], ini["area"]) if t)
            items.append({"fuente": "PTE", "entidad": ent, "cargo": cargo,
                          "desde": ym(ini["p"]), "hasta": ym(prev["p"]), "detalle": det[:160]})
            ini = prev = x
    return items, ambiguo, otra_2026


def leer_dj(path, por_clave, asesores_hits, cobertura):
    lo = hi = None
    vistos = set()
    n = 0
    with open(path, encoding="utf-8", errors="ignore", newline="") as f:
        for r in csv.DictReader(f):
            n += 1
            fp = r.get("fecha_presentacion") or ""
            if fp:
                lo = fp if lo is None or fp < lo else lo
                hi = fp if hi is None or fp > hi else hi
            k = clave(" ".join([r["ap_paterno"], r["ap_materno"], r["nombres"]]))
            if k not in por_clave or es_congreso(r["entidad"]):
                continue
            ent, cargo = r["entidad"].strip(), r["cargo"].strip()
            dedup = (k, plano(ent), r.get("fecha_inicio_cargo"))
            if dedup in vistos:
                continue
            vistos.add(dedup)
            for a in por_clave[k]:
                if a["estricto"] and not segunda_senal(a, ent, cargo):
                    continue
                asesores_hits[id(a)].append({
                    "fuente": "DJ", "entidad": ent, "cargo": cargo,
                    "desde": r.get("fecha_inicio_cargo") or None, "hasta": r.get("fecha_fin_cargo") or None,
                    "detalle": f"Declaración jurada de intereses presentada el {fp}" if fp else "Declaración jurada de intereses"})
    cobertura["dj_intereses"] = {"desde": lo, "hasta": hi, "filas": n}


def leer_designaciones(path, por_clave, asesores_hits, cobertura):
    lo = hi = None
    n = 0
    with open(path, encoding="utf-8", errors="ignore", newline="") as f:
        for r in csv.DictReader(f):
            n += 1
            fe = r.get("fecha_norma") or r.get("fecha") or ""
            if fe:
                lo = fe if lo is None or fe < lo else lo
                hi = fe if hi is None or fe > hi else hi
            if not r.get("nombre"):
                continue
            k = clave(r["nombre"])
            if k not in por_clave:
                continue
            ent, cargo = (r.get("entidad") or "").strip(), (r.get("cargo") or "").strip()
            if es_congreso(ent) or es_congreso(r.get("sumilla", "")):
                continue
            for a in por_clave[k]:
                if a["estricto"] and not segunda_senal(a, ent, cargo + " " + r.get("sumilla", "")):
                    continue
                asesores_hits[id(a)].append({
                    "fuente": "El Peruano", "entidad": ent or None, "cargo": cargo,
                    "desde": fe or None, "hasta": None,
                    "detalle": " · ".join(t for t in (r.get("norma"), (r.get("sumilla") or "")[:200]) if t),
                    "url": r.get("fuente_url") or None})
    cobertura["designaciones"] = {"desde": lo, "hasta": hi, "filas": n}


def leer_contratos(path, por_clave, asesores_hits, cobertura):
    lo = hi = None
    n = 0
    with open(path, encoding="utf-8", errors="ignore", newline="") as f:
        for r in csv.DictReader(f):
            n += 1
            fe = (r.get("fecha") or "")[:10]
            if fe:
                lo = fe if lo is None or fe < lo else lo
                hi = fe if hi is None or fe > hi else hi
            if r.get("tipo_proveedor") != "natural":
                continue
            k = clave(r.get("proveedor", ""))
            if k not in por_clave or es_congreso(r.get("comprador", "")):
                continue
            for a in por_clave[k]:
                if a["estricto"]:  # sin cargo ni área: no hay segunda señal posible
                    continue
                monto = _num(r.get("monto"))
                asesores_hits[id(a)].append({
                    "fuente": "OCDS", "entidad": (r.get("comprador") or "").strip(), "cargo": "Proveedor (persona natural)",
                    "desde": fe or None, "hasta": None,
                    "detalle": f"Buena pro {r.get('objeto') or ''} · {r.get('moneda') or 'PEN'} {monto:,.2f}".strip(),
                    "ocid": r.get("ocid") or None})
    cobertura["contratos_ocds"] = {"desde": lo, "hasta": hi, "filas": n}


# --------------------------------------------------------------------------- main
def orden(it):
    return it.get("hasta") or it.get("desde") or ""


def main() -> int:
    t0 = time.time()
    req = ["funcionarios_historico.csv", "funcionarios_v2.csv", "dj_intereses.csv",
           "designaciones.csv", "contratos.csv"]
    if not os.path.isdir(PT_DATA) or any(not os.path.exists(os.path.join(PT_DATA, f)) for f in req):
        print(f"[!] PT_DATA={PT_DATA} no existe o le faltan CSV; se conserva {OUT}")
        return 0

    asesores, por_clave, stats = cargar_asesores()
    cobertura: dict = {}
    pte = defaultdict(list)
    for f, nom in (("funcionarios_historico.csv", "pte_historico"), ("funcionarios_v2.csv", "pte_2025_2026")):
        t = time.time()
        escanear_pte(os.path.join(PT_DATA, f), por_clave, pte, cobertura, nom)
        print(f"  {f}: {cobertura[nom]['filas']:,} filas en {time.time() - t:.0f}s")
    hits = defaultdict(list)
    leer_dj(os.path.join(PT_DATA, "dj_intereses.csv"), por_clave, hits, cobertura)
    leer_designaciones(os.path.join(PT_DATA, "designaciones.csv"), por_clave, hits, cobertura)
    leer_contratos(os.path.join(PT_DATA, "contratos.csv"), por_clave, hits, cobertura)

    salida = []
    por_fuente = Counter()
    n_amb = n_otra = 0
    for a in asesores:
        items, ambiguo, otra = items_pte(a, pte.get(a["clave"], []))
        items += hits.get(id(a), [])
        if not items:
            continue
        items.sort(key=orden, reverse=True)
        items = items[:MAX_ITEMS]
        for it in items:
            por_fuente[it["fuente"]] += 1
        # Dos asesores distintos con el mismo nombre en el Congreso: también es homonimia.
        if len(por_clave[a["clave"]]) > 1:
            ambiguo = True
        e = {"nombre": a["nombre"], "despacho": a["despacho"], "camara": a["camara"], "cargo": a["cargo"],
             "historial": [{k: v for k, v in it.items() if v not in (None, "")} for it in items],
             "otra_planilla_2026": otra}
        if ambiguo:
            e["ambiguo"] = True
            n_amb += 1
        n_otra += otra
        salida.append(e)
    salida.sort(key=lambda e: (e["despacho"] or "", e["nombre"]))

    out = {
        "meta": {
            "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "fuentes": {
                "pte_historico": {"nombre": "Portal de Transparencia Estándar — planillas", **cobertura["pte_historico"]},
                "pte_2025_2026": {"nombre": "Portal de Transparencia Estándar — planillas", **cobertura["pte_2025_2026"]},
                "dj_intereses": {"nombre": "Contraloría — declaraciones juradas de intereses", **cobertura["dj_intereses"]},
                "designaciones": {"nombre": "Diario Oficial El Peruano — designaciones", **cobertura["designaciones"]},
                "contratos_ocds": {"nombre": "OECE/SEACE — contrataciones abiertas (OCDS)", **cobertura["contratos_ocds"]},
            },
            "nota": ("Cruce por nombre completo (sin DNI) con registros oficiales de otras entidades; excluye al "
                     "Congreso. Pueden existir homónimos: 'ambiguo' marca nombres con señales de más de una persona. "
                     "Nombres de 3 palabras con apellidos frecuentes requieren una segunda coincidencia (cargo o área). "
                     "'otra_planilla_2026' = figura en la planilla de otra entidad desde agosto de 2026. "
                     "Máximo 12 registros por asesor, lo más reciente primero."),
        },
        "totales": {
            "evaluados": stats["evaluados"],
            "omitidos_nombre_corto": stats["omitidos_nombre_corto"],
            "exigen_segunda_senal": stats["exigen_segunda_senal"],
            "asesores": len(salida),
            "con_historial": len(salida),
            "ambiguos": n_amb,
            "otra_planilla_2026": n_otra,
            "registros_por_fuente": dict(por_fuente),
        },
        "asesores": salida,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)  # indent: el -I"generado" del refresco necesita líneas
    os.replace(tmp, OUT)
    t = out["totales"]
    print(f"[ok] {OUT}: {t['asesores']}/{t['evaluados']} asesores con historial · ambiguos {t['ambiguos']} · "
          f"otra planilla 2026 {t['otra_planilla_2026']} · {dict(por_fuente)} · {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
