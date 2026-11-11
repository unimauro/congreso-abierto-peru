"""Registro de visitas del Congreso → web/visitas.json (quién visita a cada congresista).

Fuente oficial: https://wb2server.congreso.gob.pe/regvisitastransparencia/ (Ley de Transparencia).
`POST .../filtrar` con un rango de fechas devuelve un arreglo JSON sin paginar. Un solo registro
para todo el Congreso; el anfitrión va en `empleado` + `cargo` (DIPUTADO/SENADOR) y la oficina en
`centroCostoNombre` (para un despacho es el nombre del congresista, así que también cuentan las
visitas recibidas por sus asesores).

Privacidad: el DNI del visitante NO se guarda ni se publica (se descarta al leer).

Caché por día en data/visitas/AAAA-MM-DD.json (gitignored). Cada corrida rebaja los últimos 7 días.

    python -m pipeline.scrapers.visitas                # completa desde la instalación + refresca 7 días
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from pipeline.common.http import build_session  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(RAIZ, "web")
CACHE = os.path.join(RAIZ, "data", "visitas")
OUT = os.path.join(WEB, "visitas.json")
URL = "https://wb2server.congreso.gob.pe/regvisitastransparencia/filtrar"
INICIO = date(2026, 7, 27)  # instalación del Congreso bicameral
REFRESCAR = 7
ULTIMAS = 40  # visitas recientes por congresista en el JSON público
def entidad_real(e: str) -> bool:
    """Descarta rellenos del registro: 'SIN INSTITUCIÓN', 'S/I', 'SI', 'NINGUNA', 'PARTICULAR'..."""
    t = "".join(tokens(e))
    return bool(t) and t not in {"SININSTITUCION", "SI", "S", "NINGUNA", "NINGUNO", "PARTICULAR", "NA", "NO", "SINENTIDAD",
                                 "INDEPENDIENTE", "PERSONAL", "NINGUNO", "SN", "SINEMPRESA", "SINDATO"}


CARGOS = {"DIPUTADO", "DIPUTADA", "SENADOR", "SENADORA", "CONGRESISTA"}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\r", " ").replace("\n", " ")).strip()


def tokens(s: str) -> list[str]:
    s = unicodedata.normalize("NFKD", (s or "").upper()).encode("ascii", "ignore").decode()
    return [t for t in re.sub(r"[^A-Z ]", " ", s).split() if t not in {"DE", "LA", "DEL", "LOS", "Y"}]


def bajar_dia(session, d: date) -> list[dict]:
    body = {"fechaDesde": d.isoformat(), "fechaHasta": d.isoformat(), "visitanteCampo": "", "visitanteNombres": "",
            "empleadoCampo": "", "empleadoNombres": "", "vista": ""}
    r = session.post(URL, json=body, timeout=180)
    r.raise_for_status()
    salida = []
    for x in r.json():
        salida.append({  # sin entidadVisitanteDocumento (DNI): no se guarda
            "id": x.get("idVisita"), "fecha": d.isoformat(), "hora": norm(x.get("horaIngreso")),
            "salida": norm(x.get("fechaVisitaTermino")),
            "visitante": norm(x.get("entidadVisitanteNombreCompleto")), "entidad": norm(x.get("entidad")),
            "motivo": norm(x.get("motivo")), "tipo": norm(x.get("tipoVisita")),
            "anfitrion": norm(x.get("empleado")), "cargo": norm(x.get("cargo")),
            "oficina": norm(x.get("centroCostoNombre")), "edificio": norm(x.get("edificio")),
        })
    return salida


def actualizar_cache() -> None:
    os.makedirs(CACHE, exist_ok=True)
    session = build_session(timeout=180)
    hoy = date.today()
    d = INICIO
    while d <= hoy:
        ruta = os.path.join(CACHE, f"{d.isoformat()}.json")
        if not os.path.exists(ruta) or (hoy - d).days < REFRESCAR:
            try:
                filas = bajar_dia(session, d)
                json.dump(filas, open(ruta, "w", encoding="utf-8"), ensure_ascii=False)
                time.sleep(0.3)
            except Exception as e:  # un día caído se reintenta en la próxima corrida
                print(f"[!] {d}: {e}", file=sys.stderr)
        d += timedelta(days=1)


class Matcher:
    """Nombre del registro ('PEREZ GOMEZ, ANA' / 'PEREZ GOMEZ ANA MARIA') → congresista."""

    def __init__(self, congresistas: list[dict]):
        self.c = []
        for m in congresistas:
            ap, _, nom = m["nombre"].partition(",")
            self.c.append((tokens(ap), tokens(nom), m))
        self.cache: dict[str, dict | None] = {}

    def buscar(self, texto: str):
        if texto in self.cache:
            return self.cache[texto]
        w = tokens(texto)
        pref = lambda a, b: a[:5] == b[:5]  # tolera typos/truncados al final ("ACKERMANN", "HERBEERT")
        hits = []
        for ap, nom, m in self.c:
            if not ap or not nom:
                continue
            ok_ap = sum(1 for a in ap if any(pref(a, x) for x in w))
            ok_nom = sum(1 for n in nom if any(pref(n, x) for x in w))
            if ok_ap >= min(2, len(ap)) and ok_nom >= 1 and len(w) <= len(ap) + len(nom) + 3:
                hits.append((ok_ap + ok_nom, m))
        hits.sort(key=lambda h: -h[0])
        r = hits[0][1] if hits and (len(hits) == 1 or hits[0][0] > hits[1][0]) else None
        self.cache[texto] = r
        return r


def build() -> dict:
    congresistas = json.load(open(os.path.join(WEB, "bicameral.json"), encoding="utf-8"))["congresistas"]
    mt = Matcher(congresistas)
    por = defaultdict(list)
    total, vistos, sin_match = 0, set(), Counter()
    for f in sorted(os.listdir(CACHE)):
        if not f.endswith(".json") or f[:10] < INICIO.isoformat():
            continue
        for v in json.load(open(os.path.join(CACHE, f), encoding="utf-8")):
            if v["id"] in vistos:
                continue
            vistos.add(v["id"])
            total += 1
            m, directo = None, False
            if v["cargo"].upper() in CARGOS:
                m, directo = mt.buscar(v["anfitrion"]), True
                if not m:
                    sin_match[v["anfitrion"]] += 1
            if not m and v["oficina"] and not v["oficina"].upper().startswith(("COMISION", "DEPARTAMENTO", "AREA", "OFICINA", "GRUPO", "DIRECCION")):
                m = mt.buscar(v["oficina"])
            if m:
                por[(m["camara"], m["nombre"])].append({**v, "directo": directo})

    salida = []
    for m in congresistas:
        vs = sorted(por.get((m["camara"], m["nombre"]), []), key=lambda v: (v["fecha"], v["hora"]), reverse=True)
        ents = Counter(v["entidad"] for v in vs if entidad_real(v["entidad"]))
        salida.append({
            "camara": m["camara"], "nombre": m["nombre"], "sigla": m.get("sigla", "—"),
            "total": len(vs), "al_congresista": sum(1 for v in vs if v["directo"]),
            "dias": len({v["fecha"] for v in vs}),
            "por_mes": dict(sorted(Counter(v["fecha"][:7] for v in vs).items())),
            "top_entidades": ents.most_common(8),
            "top_tipos": Counter(v["tipo"].capitalize() for v in vs if v["tipo"]).most_common(5),
            "ultimas": [{k: v[k] for k in ("fecha", "hora", "salida", "visitante", "entidad", "motivo", "tipo", "anfitrion")}
                        for v in vs[:ULTIMAS]],
        })
    asignadas = sum(x["total"] for x in salida)
    ent_glob = Counter()
    for vs in por.values():
        ent_glob.update(v["entidad"] for v in vs if entidad_real(v["entidad"]))
    return {
        "meta": {
            "generado": date.today().isoformat(), "desde": INICIO.isoformat(),
            "fuente": "Registro de visitas del Congreso de la República (wb2server.congreso.gob.pe/regvisitastransparencia)",
            "nota": "Visitas registradas en el ingreso. Se atribuyen a un congresista cuando lo visitan a él o ella o a su "
                    "despacho (asesores). No se publica el DNI de los visitantes.",
        },
        "totales": {"visitas": total, "a_despachos": asignadas,
                    "congresistas_con_visitas": sum(1 for x in salida if x["total"])},
        "top_entidades": ent_glob.most_common(25),
        "sin_cruce": sin_match.most_common(10),
        "congresistas": sorted(salida, key=lambda x: -x["total"]),
    }


def main() -> int:
    if "--sin-descarga" not in sys.argv:
        actualizar_cache()
    data = build()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    t = data["totales"]
    print(f"[ok] {OUT} — {t['visitas']} visitas · {t['a_despachos']} a despachos · {t['congresistas_con_visitas']} congresistas"
          f" · sin cruce: {data['sin_cruce'][:5]}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
