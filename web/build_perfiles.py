"""Perfil de cada congresista desde la web oficial de su cámara → web/perfiles.json.

  - foto oficial: `featured_media` del post diputado/senador + `wp-json/wp/v2/media` (tamaño medium)
  - comisiones y cargos: `{link}sobre-el-integrante/cargos/` (HTML; filas data-cargos-row), solo activas
  - agenda de representación: `{link}representacion/informe-representacion/` (fecha, lugar, PDF)
  - viajes al exterior: `{link}viajes-al-exterior/informes/` (Diputados; casi vacío por ahora)

Las cámaras no publican actas, agendas diarias ni viajes en formato usable (los tipos WP
`actividad_diaria` y `viaje` están vacíos). Corre en CI.

    python web/build_perfiles.py
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.common.http import build_session  # noqa: E402

WEB = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(WEB, "perfiles.json")
SITIOS = {"D": ("diputados", "diputado"), "S": ("senado", "senador")}
TIPO = {"comision-ordinaria-legislativa": "Ordinaria", "comision-ordinaria-no-legislativa": "Ordinaria no legislativa",
        "comision-bicameral": "Bicameral", "comisiones-especiales": "Especial", "grupo-parlamentario": "Grupo parlamentario",
        "": "Órgano directivo"}


def texto(fragmento: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragmento))).strip()


def iso(d: str) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", d or "")
    return f"{m[3]}-{m[2]}-{m[1]}" if m else None


def filas(t: str) -> list[list[str]]:
    m = re.search(r"<main.*?</main>", t, re.S)
    t = m.group(0) if m else t
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        tds = [texto(td) for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        pdfs = re.findall(r'href="([^"]+\.pdf)"', tr, re.I)
        if tds and not any("no hay" in c.lower() for c in tds):
            out.append(tds + pdfs)
    return out


def cargos(t: str) -> list[dict]:
    salida = []
    for tipo, tr in re.findall(r'<tr data-cargos-row data-cargos-type="([^"]*)">(.*?)</tr>', t, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 4:
            continue
        nombre = re.search(r'title="([^"]+)"', tds[0])
        nombre = html.unescape(nombre[1]) if nombre else texto(tds[0])
        estado = texto(tds[4]) if len(tds) > 4 else ""
        if estado and estado.lower() != "activo":
            continue
        salida.append({"organo": nombre, "tipo": TIPO.get(tipo, tipo.replace("-", " ").capitalize()),
                       "cargo": texto(tds[1]), "desde": iso(texto(tds[2])), "hasta": iso(texto(tds[3]))})
    orden = {"Presidente": 0, "Presidenta": 0, "Vicepresidente": 1, "Vicepresidenta": 1, "Secretario": 2, "Secretaria": 2}
    return sorted(salida, key=lambda c: (orden.get(c["cargo"].split()[0] if c["cargo"] else "", 3 if "Titular" in c["cargo"] else 4), c["organo"]))


def build() -> dict:
    s = build_session(timeout=60)
    perfiles = []
    for cam, (sub, tipo) in SITIOS.items():
        base = f"https://{sub}.congreso.gob.pe"
        miembros, p = [], 1
        while True:
            r = s.get(f"{base}/wp-json/wp/v2/{tipo}", params={"per_page": 100, "page": p, "_fields": "id,title,link,featured_media"}, timeout=60)
            if r.status_code == 400:
                break
            r.raise_for_status()
            lote = r.json()
            miembros += lote
            if len(lote) < 100:
                break
            p += 1
        media = {}
        ids = [m["featured_media"] for m in miembros if m.get("featured_media")]
        for i in range(0, len(ids), 100):
            r = s.get(f"{base}/wp-json/wp/v2/media", params={"include": ",".join(map(str, ids[i:i + 100])), "per_page": 100,
                                                              "_fields": "id,source_url,media_details"}, timeout=60)
            for x in r.json():
                sizes = (x.get("media_details") or {}).get("sizes") or {}
                media[x["id"]] = (sizes.get("medium") or {}).get("source_url") or x.get("source_url")

        def uno(m):
            link = m["link"].rstrip("/") + "/"
            def get(ruta):
                try:
                    r = s.get(link + ruta, timeout=60)
                    return r.text if r.status_code == 200 else ""
                except Exception:
                    return ""
            rep = [{"fecha": iso(f[0]), "lugar": f[1] if len(f) > 1 else "", "pdf": next((x for x in f if x.lower().endswith(".pdf")), None)}
                   for f in filas(get("representacion/informe-representacion/")) if iso(f[0])]
            via = [{"fecha": iso(f[0]), "detalle": " · ".join(x for x in f[1:] if not x.lower().endswith(".pdf") and "Ver documento" not in x),
                    "pdf": next((x for x in f if x.lower().endswith(".pdf")), None)}
                   for f in filas(get("viajes-al-exterior/informes/")) if iso(f[0])] if cam == "D" else []
            return {"camara": cam, "nombre": html.unescape(m["title"]["rendered"]), "link": m["link"],
                    "foto": media.get(m.get("featured_media")), "comisiones": cargos(get("sobre-el-integrante/cargos/")),
                    "representacion": sorted(rep, key=lambda x: x["fecha"], reverse=True),
                    "viajes": sorted(via, key=lambda x: x["fecha"], reverse=True)}

        with ThreadPoolExecutor(6) as ex:
            perfiles += list(ex.map(uno, miembros))
    return {
        "meta": {"generado": date.today().isoformat(),
                 "fuente": "Webs oficiales de la Cámara de Diputados y del Senado (perfil, cargos, informes de representación y de viajes)",
                 "nota": "Solo comisiones con estado Activo. Las cámaras no publican agendas diarias ni actas por congresista."},
        "totales": {"perfiles": len(perfiles), "con_foto": sum(1 for p in perfiles if p["foto"]),
                    "con_comisiones": sum(1 for p in perfiles if p["comisiones"]),
                    "informes_representacion": sum(len(p["representacion"]) for p in perfiles),
                    "viajes": sum(len(p["viajes"]) for p in perfiles)},
        "perfiles": perfiles,
    }


def main() -> int:
    try:
        data = build()
    except Exception as e:
        print(f"[!] perfiles: {e} — se mantiene el perfiles.json anterior", file=sys.stderr)
        return 0
    if data["totales"]["perfiles"] < 150:
        print(f"[!] perfiles: solo {data['totales']['perfiles']}; no se sobrescribe", file=sys.stderr)
        return 0
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"[ok] {OUT} — {data['totales']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
