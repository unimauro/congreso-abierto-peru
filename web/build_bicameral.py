"""Genera web/bicameral.json: el Congreso bicameral 2026–2031 (Senado + Diputados).

Desde el 27-jul-2026 el Congreso tiene dos cámaras y cada una numera sus propios
proyectos. La API SPLEY los separa con `codTipoParl` ("S" Senado, "D" Diputados,
"C" Congreso/bicameral) — sin ese campo solo devuelve los "C".

Fuentes (verificadas 2026-10-26):
  - Proyectos: POST api.congreso.gob.pe/spley-portal-service/proyecto-ley/lista-con-filtro
      con codTipoParl. El filtro por bancada es `grupoParlamentarioId` (el viejo
      `grupParId` se ignora) y por congresista `congresistaId` + `tipoFirmanteId=1`
      (autor principal).
  - Combos por cámara: GET .../periodo-parlamentario/2026/filtros?codTipoParl=X
      (comisiones, bancadas, autores con su id).
  - Padrón: WordPress de cada cámara (wp-json/wp/v2/diputado | senador), con
      bancada, partido, distrito electoral y condición en las clases de taxonomía.

    python web/build_bicameral.py --fecha 2026-10-26
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.scrapers.proyectos_ley import LISTA_ENDPOINT, _filtro, API_BASE  # noqa: E402
from pipeline.common.http import build_session  # noqa: E402
from build_data import clasificar_materia, es_ley  # noqa: E402

PERIODO = 2026
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bicameral.json")

CAMARAS = {
    "D": {"nombre": "Cámara de Diputados", "wp": "diputados", "tipo": "diputado", "miembros": 130},
    "S": {"nombre": "Senado", "wp": "senado", "tipo": "senador", "miembros": 60},
}

BANCADAS = {  # slug WP -> nombre y sigla (las siglas son las de las actas del Pleno)
    "fuerza-popular": ("Fuerza Popular", "FP"),
    "juntos-por-el-peru": ("Juntos por el Perú", "JP"),
    "partido-del-buen-gobierno": ("Partido del Buen Gobierno", "PBG"),
    "renovacion-popular": ("Renovación Popular", "RP"),
    "partido-civico-obras": ("Partido Cívico Obras", "PCO"),
    "ahora-nacion": ("Ahora Nación", "AN"),
}

# Agenda de desarrollo: ¿el proyecto apunta a crecimiento, competitividad o
# servicios básicos? Ejes inspirados en la Política Nacional de Competitividad y
# Productividad y las políticas de Estado del Acuerdo Nacional. Es indicativo:
# se infiere por palabras clave del título (la primera coincidencia gana).
AGENDA = [
    # Las "actualizaciones" re-presentan proyectos del Congreso anterior (2ª DCT del
    # Reglamento): su título no dice la materia, así que van aparte.
    ("Actualización (periodo anterior)", ("ACTUALIZACIÓN DE CONFORMIDAD", "ACTUALIZACION DE CONFORMIDAD")),
    ("Simbólico / declarativo", ("DECLARA DE INTERES", "DECLARA DE INTERÉS", "DECLARA DE NECESIDAD",
        "DECLÁRESE", "DECLARESE", "DÍA NACIONAL", "DIA NACIONAL", "HOMENAJE", "HÉROE", "HEROE",
        "BENEMÉRIT", "DECLARA COMO", "DECLARA CIUDAD", "PATRIMONIO CULTURAL", "DENOMINA", "DÍA DE",
        "SEMANA DE")),
    ("Finanzas públicas y presupuesto", ("PRESUPUESTO DEL SECTOR", "ENDEUDAMIENTO", "EQUILIBRIO FINANCIERO",
        "CRÉDITO SUPLEMENTARIO", "CREDITOS SUPLEMENTARIOS", "CRÉDITOS SUPLEMENTARIOS", "CUENTA GENERAL",
        "TRIBUT", "IMPUESTO", "IGV", "RECAUDA", "AÑO FISCAL", "POLÍTICA FISCAL", "RESPONSABILIDAD FISCAL", "FONDO MONETARIO", "FONDO SOBERANO", "GASTO EN PUBLICIDAD")),
    ("Inversión, empleo y competitividad", ("INVERSI", "MYPE", "EMPRESA", "EMPLEO", "FORMALIZ",
        "EXPORTA", "COMPETITIV", "PRODUCTIV", "TURISMO", "INNOVACI", "EMPRENDIM", "COMERCIO",
        "MINER", "HIDROCARBUR", "ENERG", "AGRO", "AGRARI", "AGRÍCOL", "PESQUER", "PESCA", "FINANCIER",
        "CRÉDITO", "CREDITO", "MERCADO", "CONCESI", "ASOCIACIONES PÚBLICO", "OBRAS POR IMPUESTOS",
        "CATASTR", "TITULACI", "PROPIEDAD", "ECONÓMIC", "ECONOMIC", "ARTESAN", "LABORAL", "TRABAJ",
        "PRIMERA EXPERIENCIA", "CONSUMIDOR", "ZONA FRANCA", "ARROZ", "ALQUILA")),
    ("Infraestructura y conectividad", ("CARRETERA", "VIAL", "FERROVI", "TREN ", "PUERTO", "PORTUARI",
        "AEROPUERTO", "AGUA", "SANEAMIENTO", "INTERNET", "CONECTIVIDAD", "TELECOMUNIC",
        "INFRAESTRUCTURA", "VIVIENDA", "TRANSPORTE", "OBRA PÚBLICA", "RECONSTRUCCI", "FENÓMENO EL NIÑO",
        "FENOMENO EL NIÑO", "RIEGO", "DIQUE", "PASAJE", "CORREDOR", "OBRAS PÚBLICAS", "DESARROLLO URBANO")),
    ("Capital humano: educación y salud", ("EDUCAC", "ESCOLAR", "ESCUELA", "UNIVERSID", "DOCENTE",
        "ESTUDIANTE", "SALUD", "HOSPITAL", "ESSALUD", "ANEMIA", "DESNUTRI", "MÉDIC", "MEDIC", "VACUNA",
        "CIENCIA", "TECNOLOG", "CURRÍCULO", "ACADÉMIC", "BECAS", "CÁNCER", "NUTRICI", "OBSTÉTRIC")),
    ("Ambiente y gestión de riesgos", ("AMBIENT", "DEFORESTA", "RIESGO DE DESASTRES", "CONTAMINA",
        "LAGUNA", "ESPECIES", "FORESTAL", "CLIMÁTIC", "CLIMATIC", "RESIDUOS")),
    ("Inclusión y protección social", ("PROTECCIÓN SOCIAL", "PROTECCION SOCIAL", "ADULTO MAYOR",
        "DISCAPACIDAD", "MUJER", "NIÑ", "ADOLESCEN", "FAMILIA", "VIOLENCIA", "POBREZA", "PROGRAMA SOCIAL",
        "BENEFICENCIA", "PENSI", "19990", "20530", "COMUNIDADES CAMPESINAS", "PUEBLOS INDÍGENAS",
        "CUIDADOS", "ALIMENTOS", "RECIÉN NACIDO")),
    ("Seguridad y Estado de derecho", ("SEGURIDAD CIUDADANA", "DELINCUENC", "EXTORSI", "CRIMEN",
        "CRIMINAL", "SICARIA", "TERRORISMO", "ORDEN INTERNO", "POLIC", "CORRUPCI", "CONTRALOR",
        "PENAL", "DELITO", "PENITENCIARI", "JUSTICIA", "EXTINCIÓN DE DOMINIO", "DEFENSA CIVIL",
        "FISCALÍA", "MINISTERIO PÚBLICO", "SANCION", "ARMAS", "INTELIGENCIA", "DERECHOS HUMANOS", "CRÍMENES")),
    ("Gestión del Estado y simplificación", ("MODERNIZ", "SIMPLIFIC", "DIGITAL", "INTEROPERAB",
        "GOBIERNO ELECTR", "TRÁMITE", "TRAMITE", "TRANSPARENCIA", "SERVICIO CIVIL",
        "PROCEDIMIENTO ADMINISTRATIVO", "PODER EJECUTIVO", "DESCENTRALIZ", "GOBIERNOS REGIONALES",
        "MUNICIPALIDAD")),
    ("Reforma política e institucional", ("CONSTITUC", "ELECTORAL", "ORGANIZACIONES POLÍTICAS",
        "REGLAMENTO DEL CONGRESO", "ELECCIÓN", "ELECCION", "PARTIDO", "REFERÉNDUM", "INMUNIDAD", "VACANCIA", "REGLAMENTO DE LA CÁMARA", "ÉTICA", "RESOLUCIÓN LEGISLATIVA")),
]
# Ejes que empujan crecimiento, competitividad o servicios básicos (lo que aquí
# llamamos "agenda de desarrollo"); simbólico, actualización, reforma política
# y "Otros" no cuentan.
EJES_DESARROLLO = {
    "Finanzas públicas y presupuesto", "Inversión, empleo y competitividad",
    "Infraestructura y conectividad", "Capital humano: educación y salud",
    "Inclusión y protección social", "Seguridad y Estado de derecho",
    "Gestión del Estado y simplificación", "Ambiente y gestión de riesgos",
}

# Bandera de riesgo fiscal: crea gasto o renuncia a ingresos (el MEF suele
# observarlos). Independiente del eje: un proyecto de salud puede tenerla.
RIESGO_FISCAL = ("EXONERA", "BONO", "BONIFICACI", "NOMBRAMIENTO", "NOMBRA ", "REINCORPORA", "INCORPORA A",
    "INCORPORA AL RÉGIMEN", "CONDONA", "AMNIST", "INAFECT", "BENEFICIO TRIBUTARIO", "DEVOLUCI",
    "INCREMENTO", "INCREMENTA", "HOMOLOGA", "PENSIÓN", "PENSION", "SUBSIDIO", "PRORROGA", "PRÓRROGA",
    "FRACCIONAMIENTO", "REPROGRAMA")


ACTUALIZACION, SIMBOLICO = AGENDA[0][0], AGENDA[1][0]


def pct(parte: int, total: int) -> float:
    return round(parte / total * 100, 1) if total else 0


def clasificar_agenda(titulo: str) -> str:
    t = (titulo or "").upper()
    for nombre, claves in AGENDA:
        if any(k in t for k in claves):
            return nombre
    return "Otros"


def riesgo_fiscal(titulo: str) -> bool:
    t = (titulo or "").upper()
    return any(k in t for k in RIESGO_FISCAL)


def tokens(s: str) -> list[str]:
    s = unicodedata.normalize("NFKD", (s or "").upper()).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z ]", " ", s).split()


def clave_nombre(nombre: str) -> tuple:
    """(apellidos, primer nombre) normalizados — para cruzar fuentes con nombres truncados."""
    ap, _, nom = nombre.partition(",")
    return tuple(tokens(ap)), (tokens(nom) or [""])[0]


def consultar(session, cam: str, **filtros) -> list[dict]:
    body = _filtro(PERIODO)
    body["codTipoParl"] = cam
    body.update(filtros)
    r = session.post(LISTA_ENDPOINT, params={"pageSize": 100000, "page": 1, "rowStart": 0},
                     json=body, timeout=180)
    r.raise_for_status()
    return (r.json().get("data") or {}).get("proyectos") or []


def fetch_padron(session) -> list[dict]:
    padron = []
    for cam, cfg in CAMARAS.items():
        page = 1
        while True:
            r = session.get(f"https://{cfg['wp']}.congreso.gob.pe/wp-json/wp/v2/{cfg['tipo']}",
                            params={"per_page": 100, "page": page, "_fields": "slug,title,link,class_list"},
                            timeout=60)
            if r.status_code == 400:  # página fuera de rango
                break
            r.raise_for_status()
            lote = r.json()
            for x in lote:
                tax = {}
                for c in x.get("class_list", []):
                    for k in ("grupo_parlamentario", "partido_politico", "distrito_electoral", "genero", "condicion"):
                        if c.startswith(k + "-"):
                            tax[k] = c[len(k) + 1:]
                bslug = tax.get("grupo_parlamentario", "")
                bancada, sigla = BANCADAS.get(bslug, (bslug.replace("-", " ").title() or "—", "—"))
                padron.append({
                    "camara": cam,
                    "nombre": re.sub(r"\s+", " ", x["title"]["rendered"]).strip(),
                    "bancada": bancada, "sigla": sigla,
                    "distrito": tax.get("distrito_electoral", "").replace("-", " ").title(),
                    "genero": tax.get("genero", ""),
                    "condicion": tax.get("condicion", "").replace("-", " "),
                    "link": x["link"],
                })
            if len(lote) < 100:
                break
            page += 1
    return padron


def resumen_proyectos(ps: list[dict]) -> dict:
    estados = Counter(p["desEstado"] for p in ps)
    meses = Counter((p.get("fecPresentacion") or "")[:7] for p in ps if p.get("fecPresentacion"))
    prop = Counter((p.get("desProponente") or "—").strip() for p in ps)
    materias, agenda = Counter(), Counter()
    riesgo = 0
    for p in ps:
        materias[clasificar_materia(p["titulo"])] += 1
        agenda[clasificar_agenda(p["titulo"])] += 1
        riesgo += riesgo_fiscal(p["titulo"])
    n = len(ps)
    desarrollo = sum(c for a, c in agenda.items() if a in EJES_DESARROLLO)
    base = n - agenda.get(ACTUALIZACION, 0)  # % sobre proyectos con materia legible
    return {
        "proyectos": n,
        "leyes": sum(1 for p in ps if es_ley(p["desEstado"])),
        "archivados": sum(c for e, c in estados.items() if "ARCHIV" in e.upper()),
        "por_estado": dict(estados.most_common()),
        "por_mes": dict(sorted(meses.items())),
        "por_proponente": dict(prop.most_common()),
        "materias": dict(materias.most_common()),
        "agenda": dict(agenda.most_common()),
        "pct_desarrollo": pct(desarrollo, base),
        "pct_simbolico": pct(agenda.get(SIMBOLICO, 0), base),
        "riesgo_fiscal": riesgo,
        "actualizaciones": agenda.get(ACTUALIZACION, 0),
    }


def build(fecha: str, pausa: float = 0.25) -> dict:
    session = build_session(timeout=120)

    print("[*] padrón (WordPress de cada cámara)...", file=sys.stderr)
    try:
        padron = fetch_padron(session)
    except Exception as e:  # el WP puede bloquear IPs de CI: reusar el padrón versionado
        print(f"[!] padrón no disponible ({e}); se reusa el anterior", file=sys.stderr)
        padron = json.load(open(OUT, encoding="utf-8"))["congresistas"] if os.path.exists(OUT) else []
        for m in padron:
            for k in ("principal", "firmas", "pleys"):
                m.pop(k, None)
    print(f"    {len(padron)} congresistas", file=sys.stderr)
    por_clave = {(m["camara"], clave_nombre(m["nombre"])): m for m in padron}
    # Respaldo para nombres abreviados en una fuente ("Duarte, Georgina" en el
    # padrón vs "Duarte Patiño de Pezet, Carmen Georgina" en la API).
    por_apellido = defaultdict(list)
    for m in padron:
        ap, nom = clave_nombre(m["nombre"])
        por_apellido[(m["camara"], ap[:1])].append(m)

    def buscar(cam: str, nombre: str):
        m = por_clave.get((cam, clave_nombre(nombre)))
        if m:
            return m
        ap, _ = clave_nombre(nombre)
        resto = nombre.partition(",")[2]
        nombres = set(tokens(resto))
        cands = [c for c in por_apellido.get((cam, ap[:1]), [])
                 if set(tokens(c["nombre"].partition(",")[2])) & nombres]
        return cands[0] if len(cands) == 1 else None

    camaras, todos = {}, []
    for cam in ("D", "S", "C"):
        print(f"[*] proyectos {cam}...", file=sys.stderr)
        ps = consultar(session, cam)
        print(f"    {len(ps)}", file=sys.stderr)
        for p in ps:
            p["_agenda"] = clasificar_agenda(p["titulo"])
        todos.extend(ps)
        info = {"nombre": CAMARAS.get(cam, {}).get("nombre", "Congreso (bicameral)"), **resumen_proyectos(ps)}

        if cam in CAMARAS:
            combos = session.get(f"{API_BASE}/periodo-parlamentario/{PERIODO}/filtros",
                                 params={"codTipoParl": cam}, timeout=60).json()["data"]

            # Bancadas: proyectos por grupo parlamentario (dato oficial, no inferido)
            miembros_bancada = Counter(m["bancada"] for m in padron if m["camara"] == cam)
            bancadas = []
            for g in combos.get("gruposParlamentarios", []):
                gp = consultar(session, cam, grupoParlamentarioId=g["id"])
                time.sleep(pausa)
                nm = miembros_bancada.get(g["descripcion"], 0)
                ag = Counter(clasificar_agenda(p["titulo"]) for p in gp)
                base = len(gp) - ag.get(ACTUALIZACION, 0)
                bancadas.append({
                    "bancada": g["descripcion"], "miembros": nm, "proyectos": len(gp),
                    "por_miembro": round(len(gp) / nm, 1) if nm else None,
                    "actualizaciones": ag.get(ACTUALIZACION, 0),
                    "pct_desarrollo": pct(sum(c for a, c in ag.items() if a in EJES_DESARROLLO), base),
                    "pct_simbolico": pct(ag.get(SIMBOLICO, 0), base),
                })
            info["bancadas"] = sorted(bancadas, key=lambda b: -b["proyectos"])

            # Comisiones: proyectos derivados a cada una
            comisiones = []
            for c in combos.get("comisiones", []):
                n = len(consultar(session, cam, comisionId=c["id"]))
                time.sleep(pausa)
                comisiones.append({"nombre": c["descripcion"], "proyectos": n})
            info["comisiones"] = sorted(comisiones, key=lambda c: -c["proyectos"])

            # Congresistas: proyectos como autor principal (filtro oficial) y firmas totales
            firmas = Counter(a.strip() for p in ps for a in (p.get("autores") or "").split(";") if a.strip())
            sin_match = 0
            for a in combos.get("autores", []):
                lead = consultar(session, cam, congresistaId=a["id"], tipoFirmanteId=1)
                time.sleep(pausa)
                m = buscar(cam, a["descripcion"])
                if not m:
                    sin_match += 1
                    m = {"camara": cam, "nombre": a["descripcion"], "bancada": "—", "sigla": "—",
                         "distrito": "", "genero": "", "condicion": "", "link": ""}
                    padron.append(m)
                    por_clave[(cam, clave_nombre(a["descripcion"]))] = m
                ag = Counter(clasificar_agenda(p["titulo"]) for p in lead)
                m["principal"] = len(lead)
                m["firmas"] = firmas.get(a["descripcion"], 0)
                m["simbolicos"] = ag.get(SIMBOLICO, 0)
                m["actualizaciones"] = ag.get(ACTUALIZACION, 0)
                m["desarrollo"] = sum(c for x, c in ag.items() if x in EJES_DESARROLLO)
                m["pleys"] = sorted(p["pleyNum"] for p in lead)
            if sin_match:
                print(f"[!] {sin_match} autores de {cam} sin cruce con el padrón", file=sys.stderr)
        camaras[cam] = info

    for m in padron:
        m.setdefault("principal", 0)
        m.setdefault("firmas", 0)
        m.setdefault("simbolicos", 0)
        m.setdefault("actualizaciones", 0)
        m.setdefault("desarrollo", 0)
        m.setdefault("pleys", [])

    recientes = sorted(todos, key=lambda p: (p.get("fecPresentacion") or "", p["pleyNum"]), reverse=True)[:40]
    return {
        "meta": {
            "generado": fecha,
            "periodo": "2026-2031",
            "instalacion": "2026-07-27",
            "fuente": "api.congreso.gob.pe/spley-portal-service (codTipoParl S/D/C) · padrón: senado/diputados.congreso.gob.pe",
        },
        "totales": {
            "proyectos": len(todos),
            "leyes": sum(1 for p in todos if es_ley(p["desEstado"])),
            "congresistas": len(padron),
        },
        "camaras": camaras,
        "congresistas": sorted(padron, key=lambda m: (m["camara"], -m["principal"], m["nombre"])),
        "recientes": [{
            "codigo": p["proyectoLey"], "camara": p["codTipoParl"], "estado": p["desEstado"],
            "fecha": (p.get("fecPresentacion") or "")[:10], "titulo": p["titulo"].strip(),
            "proponente": p.get("desProponente"), "agenda": p["_agenda"],
            "riesgo_fiscal": riesgo_fiscal(p["titulo"]),
        } for p in recientes],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fecha", required=True, help="Fecha de generación YYYY-MM-DD")
    args = ap.parse_args()
    data = build(args.fecha)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    t = data["totales"]
    print(f"[ok] {OUT} — {t['proyectos']} proyectos · {t['congresistas']} congresistas", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
