"""Sesiones del Pleno (Senado y Diputados): agenda, asistencia y votaciones nominales.

Cada cámara publica en su web los PDF de cada sesión: agenda, "temas tratados",
actas y el reporte de asistencia + votaciones. Ese reporte trae, por cada pase de
lista y cada votación, el estado de los 130/60 congresistas (PRE, AUS, SI, NO,
licencias…) y al pie el resultado oficial por bancada.

Muchos de esos PDF son escaneos: si `pdftotext` no devuelve texto se pasa por OCR
(pdftoppm + tesseract, idioma spa). Por eso este scraper corre en la laptop, no en
CI. El texto extraído se cachea en data/plenos/ para no repetir el OCR.

Calidad: un bloque (pase de lista o votación) solo se usa si la cantidad de
"presentes" / "a favor" parseada coincide con el total oficial impreso al pie del
mismo bloque (tolerancia ±2 por OCR). Los descartados se reportan en `calidad`.

    python -m pipeline.scrapers.plenos            # escribe web/plenos.json

Voto nominal (compacto): cada `camaras[cam].votaciones[i]` lleva
  - `id`: estable, "<cam>-<AAAAMMDD>-<HHMM 24h>" (p. ej. "D-20261029-1156"; si dos
    votaciones caen en el mismo minuto se agrega "b", "c"…).
  - `votos`: una cadena con un carácter por congresista de esa cámara, en el orden de
    `camaras[cam].nominal_orden` (lista de nombres = mismo orden que `miembros`).
    Códigos: S=sí, N=no, A=abstención, X=ausente, L=licencia, R=sin respuesta,
    P=presente sin voto, "-"=sin dato (no figura en el acta o no se pudo cruzar).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from pipeline.common.http import build_session  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, "data", "plenos")
BICAMERAL = os.path.join(RAIZ, "web", "bicameral.json")
OUT = os.path.join(RAIZ, "web", "plenos.json")

PAGINAS = {
    "D": "https://diputados.congreso.gob.pe/sesiones-del-pleno/",
    "S": "https://senado.congreso.gob.pe/sesiones_del_pleno/",
}

MESES = {m: i for i, m in enumerate(
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
     "septiembre", "octubre", "noviembre", "diciembre"], 1)}
MESES["setiembre"] = 9
MES_ABR = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8,
           "set": 9, "sep": 9, "oct": 10, "nov": 11, "dic": 12}

# Códigos de estado de las actas (asistencia y votación).
PRESENTE, AUSENTE = {"PRE"}, {"AUS"}
VOTO = {"SI": "si", "NO": "no", "ABST": "abst", "ABS": "abst", "SINR": "sin_resp", "SR": "sin_resp"}
LICENCIAS = {"LV", "LVO", "LSGH", "LE", "LAP", "LO", "LA", "LP", "LSC", "LMD", "LOF", "LEN", "SUS"}
ESTADOS = PRESENTE | AUSENTE | set(VOTO) | LICENCIAS

_BANCADA = r"[A-Z0-9][A-Za-z0-9)]{0,4}"  # incluye "OBRAS" (sigla de PCO en agosto)
# En las actas escaneadas el voto va dentro de un recuadro y el OCR lo lee como
# "Si", "Sl", "S]]", "El]", "NO—"… Se aceptan esas variantes y se normalizan;
# la validación contra el total oficial descarta el bloque si la lectura falla.
_OCR_SI = r"[Ss][IiLl1|]\]*|S\]+|E(?:[l1I]\]*|\]+)"
_OCR_NO = r"N[O0o](?:\s?[—\-]+)*"
_OCR_SINR = r"Sin\s?Res\w*"
_OCR_ABST = r"Abst?"  # las actas de Diputados escriben "Abst." en minúsculas
_ENTRADA = re.compile(
    rf"(?P<b>{_BANCADA})\s+(?P<n>[A-ZÁÉÍÓÚÑÜ][^\n]*?)\s*[—\-.]*\s+"
    rf"(?P<s>{'|'.join(sorted(ESTADOS, key=len, reverse=True))}|{_OCR_SINR}|{_OCR_ABST}|{_OCR_SI}|{_OCR_NO})[\]|.]*"
    rf"(?=\s+{_BANCADA}\s+[A-ZÁÉÍÓÚÑÜ]|\s*$)", re.M)


def _estado(s: str) -> str:
    if s in ESTADOS:
        return s
    if re.fullmatch(_OCR_SINR, s):
        return "SINR"
    if re.fullmatch(_OCR_ABST, s):
        return "ABST"
    return "NO" if re.fullmatch(_OCR_NO, s) else "SI"

# Una fila de votos empieza con la sigla de bancada (con variantes de OCR: "PCo", "0)").
# Código de un carácter por estado para la cadena `votos` (ver docstring).
def codigo_voto(st: str | None) -> str:
    if st is None:
        return "-"
    v = VOTO.get(st)
    if v:
        return {"si": "S", "no": "N", "abst": "A", "sin_resp": "R"}[v]
    return "X" if st in AUSENTE else "P" if st in PRESENTE else "L"


_FILA = re.compile(r"\s*(AN|FP|JP|PBG|PC[A-Za-z0-9]{0,2}|RP|OBRAS|\d{1,2}\))\s+[A-ZÁÉÍÓÚÑÜ]")


# ---------------------------------------------------------------- descarga + texto

def listar_pdfs(session, cam: str) -> list[str]:
    html = session.get(PAGINAS[cam], timeout=60).text
    return sorted(set(re.findall(r'href="(https://[^"]+?\.pdf)"', html)))


def tipo_doc(url: str) -> str | None:
    f = os.path.basename(url).upper()
    if "ASISTENCIA" in f:
        return "asistencia"
    if "AGENDA" in f:
        return "agenda"
    if "ACTA" in f:
        return "acta"
    if "TEMAS" in f or "_CTT_" in f or "TT_" in f:
        return "temas"
    return None  # PLO (cuadros de licencias), juramentación, etc.


def fecha_de_nombre(url: str) -> str | None:
    f = _fecha_de_nombre(url)
    # El Congreso a veces escribe mal el año en el nombre ("...-05-08-2025.pdf" subido en
    # uploads/2026/08): si el año es anterior al de la carpeta de subida, manda la carpeta.
    sub = re.search(r"/uploads/(20\d\d)/(\d\d)/", url)
    if f and sub and f[:4] < sub[1] and f[5:7] <= sub[2]:
        f = sub[1] + f[4:]
    return f


def _fecha_de_nombre(url: str) -> str | None:
    f = os.path.basename(url)
    m = re.search(r"(\d{1,2})[-_.](\d{1,2})[-_.](20\d\d)", f)
    if m:
        return f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}"
    m = re.search(r"(\d{1,2})[._]([a-z]{3})[a-z]*[._]+_?(20\d\d)", f, re.I)
    if m and m[2].lower() in MES_ABR:
        return f"{m[3]}-{MES_ABR[m[2].lower()]:02d}-{int(m[1]):02d}"
    m = re.search(r"(20\d\d)(\d\d)(\d\d)", f)
    if m:
        return f"{m[1]}-{m[2]}-{m[3]}"
    return None


def texto_pdf(session, url: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, os.path.basename(url) + ".txt")
    if os.path.exists(cache):
        return open(cache, encoding="utf-8").read()
    with tempfile.TemporaryDirectory() as tmp:
        pdf = os.path.join(tmp, "doc.pdf")
        r = session.get(url, timeout=120)
        r.raise_for_status()
        open(pdf, "wb").write(r.content)
        txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
        if len(re.findall(r"[A-Za-z]", txt)) < 500:  # escaneo: OCR página por página
            print(f"    OCR {os.path.basename(url)}...", file=sys.stderr)
            subprocess.run(["pdftoppm", "-r", "300", "-png", pdf, os.path.join(tmp, "p")], check=True)
            paginas = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
            txt = "\n\f".join(
                subprocess.run(["tesseract", os.path.join(tmp, p), "stdout", "-l", "spa", "--psm", "6"],
                               capture_output=True, text=True).stdout for p in paginas)
    open(cache, "w", encoding="utf-8").write(txt)
    return txt


# ---------------------------------------------------------------- parseo

_SIGLA_EN_NOMBRE = re.compile(r"(AN|FP|JP|PBG|PC[Oo]|RP)\s+(?=[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'\s-]*[A-ZÁÉÍÓÚÑÜ])")


def _resiglar(b: str, n: str, st: str) -> tuple[str, str, str]:
    """Basura de OCR antes de la sigla ("A  FP  AGUINAGA…"): la sigla real queda al
    inicio del nombre; se corrige."""
    m = _SIGLA_EN_NOMBRE.match(n)
    if m:
        return m[1].upper(), n[m.end():], st
    return b, n, st


def _unir_nombres_partidos(filas: str) -> str:
    """En los PDF con texto (pdftotext -layout) los nombres largos se parten: los
    apellidos quedan solos en la línea de arriba ("ANDRADE SALGUERO DE ALVAREZ,") y la
    fila solo trae los nombres ("FP  GLADYS GRISELDA  SI"). Se vuelven a unir por columna."""
    # El estado de la 3.ª columna a veces cae solo en la línea siguiente: se sube.
    lineas: list[str] = []
    for ln in filas.split("\n"):
        if lineas and _FILA.match(lineas[-1]) and re.fullmatch(r"\s+(?:SI|NO|Abst\.?|ABST|AUS|PRE|SinRes\w*|L[A-Z]{1,3})\s*", ln):
            lineas[-1] += "  " + ln.strip()
            continue
        lineas.append(ln)
    out: list[str] = []
    for ln in lineas:
        prev = out[-1] if out else ""
        if prev.strip() and not _FILA.match(prev) and _FILA.match(ln) and ":" not in prev:
            trozos = [[m.start(), m.group(), False] for m in re.finditer(r"\S+(?: \S+)*", prev)]
            huecos = [m.start("n") for m in _ENTRADA.finditer(ln) if "," not in m["n"]]
            nuevo = ln
            for col in sorted(huecos, reverse=True):
                libres = [t for t in trozos if not t[2] and abs(t[0] - col) <= 16]
                if libres:
                    t = min(libres, key=lambda t: abs(t[0] - col))
                    t[2] = True
                    nuevo = nuevo[:col] + t[1] + " " + nuevo[col:]
            if any(t[2] for t in trozos):
                resto = "  ".join(t[1] for t in trozos if not t[2])
                out[-1] = resto  # lo que no se pudo ubicar se deja como estaba
                ln = nuevo
        out.append(ln)
    return "\n".join(out)


def parse_bloques(txt: str) -> list[dict]:
    """Divide el reporte en pases de lista y votaciones con sus entradas y totales oficiales."""
    bloques = []
    partes = re.split(r"\n(?=[^\n]*(?:ASISTENCIA|VOTACI[ÓO]N):\s*Fecha)", txt)
    for parte in partes:
        cab = re.search(r"(ASISTENCIA|VOTACI[ÓO]N):\s*Fecha:\s*(\d\d)/(\d\d)/(\d{4})\s+Hora:\s*([\d:]+\s*[AP]M)", parte)
        if not cab:
            continue
        tipo = "asistencia" if cab[1] == "ASISTENCIA" else "votacion"
        cuerpo = parte[cab.end():]
        corte = re.search(r"RESULTADO DE|Resultado de", cuerpo)
        filas, pie = (cuerpo[:corte.start()], cuerpo[corte.start():]) if corte else (cuerpo, "")
        asunto = ""
        if tipo == "votacion":
            # El asunto termina en la primera línea en blanco o en la primera fila de
            # votos (el OCR a veces no deja líneas en blanco).
            m = re.search(r"Asunto:", filas)
            if m:
                lineas, resto = [], filas[m.end():].split("\n")
                for i, ln in enumerate(resto):
                    if (lineas and not ln.strip()) or _FILA.match(ln):
                        break
                    lineas.append(ln)
                asunto = re.sub(r"\s+", " ", " ".join(lineas)).strip()
                filas = "\n".join(resto[i:])
        filas = _unir_nombres_partidos(filas)
        entradas = [_resiglar(m["b"], m["n"].strip(" ,.—-"), _estado(m["s"])) for m in _ENTRADA.finditer(filas)]

        def total(etiqueta: str) -> int | None:
            m = re.search(etiqueta + r"\s+(\d+)", pie)
            return int(m[1]) if m else None

        bloques.append({
            "tipo": tipo, "fecha": f"{cab[4]}-{cab[3]}-{cab[2]}", "hora": cab[5].replace(" ", ""),
            "asunto": asunto, "entradas": entradas,
            "oficial": {
                "presentes": total(r"\nPRESENTE"), "si": total(r"A FAVOR \(SI\)"),
                "no": total(r"EN CONTRA \(NO\)"), "abst": total(r"ABSTENCI[ÓO]N"),
            },
        })
    return bloques


def valido(b: dict) -> bool:
    estados = Counter(s for _, _, s in b["entradas"])
    if b["tipo"] == "asistencia":
        ref, got = b["oficial"]["presentes"], estados["PRE"]
    else:
        ref, got = b["oficial"]["si"], estados["SI"]
    return ref is not None and abs(ref - got) <= 2


# ---------------------------------------------------------------- cruce con padrón

def _tok(s: str) -> list[str]:
    s = unicodedata.normalize("NFKD", (s or "").upper()).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z ]", " ", s).split()


class Padron:
    """Resuelve nombres truncados/OCR del acta ("ANDRADE SALGUERO DE") contra el padrón."""

    def __init__(self, congresistas: list[dict]):
        self.por_cam = defaultdict(list)
        for m in congresistas:
            ap, _, nom = m["nombre"].partition(",")
            self.por_cam[m["camara"]].append((_tok(ap), _tok(nom), m))

    def buscar(self, cam: str, sigla: str, nombre: str):
        ap, _, nom = nombre.partition(",")
        a, n = _tok(ap), _tok(nom)
        if not a:
            return None

        def score(cand):
            ca, cn, m = cand
            # apellidos del acta deben ser prefijo (tolerando el último truncado)
            if len(a) > len(ca) or any(x != y for x, y in zip(a[:-1], ca)) or not ca[len(a) - 1].startswith(a[-1][:4]):
                return -1
            s = len(a) * 2 + sum(1 for x in n if any(y.startswith(x[:4]) for y in cn))
            return s + (1 if m.get("sigla") == sigla else 0)

        cands = sorted(((score(c), c[2]) for c in self.por_cam[cam]), key=lambda x: -x[0])
        if cands and cands[0][0] > 0 and (len(cands) == 1 or cands[0][0] > cands[1][0]):
            return cands[0][1]
        # respaldo OCR: el primer apellido coincide en sus 5 primeras letras y es único
        f = [c for c in self.por_cam[cam] if c[0] and c[0][0][:5] == a[0][:5]]
        return f[0][2] if len(f) == 1 else None


# ---------------------------------------------------------------- armado

def _hhmm(hora: str) -> str:
    """'1:05PM' -> '1305' (24 h) para el id estable de cada votación."""
    m = re.fullmatch(r"(\d{1,2}):(\d\d)(?::\d\d)?([AP]M)", hora)
    if not m:
        return re.sub(r"\D", "", hora)
    h = int(m[1]) % 12 + (12 if m[3] == "PM" else 0)
    return f"{h:02d}{m[2]}"


def build() -> dict:
    session = build_session(timeout=120)
    congresistas = json.load(open(BICAMERAL, encoding="utf-8"))["congresistas"]
    padron = Padron(congresistas)
    miembros = {}
    for m in congresistas:
        miembros[(m["camara"], m["nombre"])] = {
            "camara": m["camara"], "nombre": m["nombre"], "sigla": m.get("sigla", "—"),
            "pases": 0, "presente": 0, "ausente": 0, "licencia": 0,
            "votaciones": 0, "si": 0, "no": 0, "abst": 0, "no_voto": 0,
            "con_bancada": 0, "contra_bancada": 0,
        }

    salida = {"camaras": {}, "calidad": {}}
    for cam in PAGINAS:
        orden = sorted(m["nombre"] for m in congresistas if m["camara"] == cam)
        idx = {n: i for i, n in enumerate(orden)}
        ids_usados = set()
        print(f"[*] Pleno {cam}: listando PDFs...", file=sys.stderr)
        sesiones = defaultdict(lambda: {"documentos": {}})
        votaciones, pases = [], 0
        cal = Counter()
        for url in listar_pdfs(session, cam):
            tipo = tipo_doc(url)
            if not tipo:
                continue
            f = fecha_de_nombre(url)
            if tipo != "asistencia":
                if f:
                    sesiones[f]["documentos"].setdefault(tipo, url)
                continue
            try:
                txt = texto_pdf(session, url)
            except Exception as e:
                print(f"[!] {os.path.basename(url)}: {e}", file=sys.stderr)
                cal["pdf_error"] += 1
                continue
            for b in parse_bloques(txt):
                sesiones[b["fecha"]]["documentos"].setdefault("asistencia", url)
                cal[b["tipo"] + "_total"] += 1
                if not valido(b):
                    cal[b["tipo"] + "_descartado"] += 1
                    continue
                sin = 0
                vistos = set()  # un congresista cuenta una sola vez por bloque
                por_bancada = defaultdict(Counter)
                emitidos = []  # (registro, sigla, voto) para medir disciplina de bancada
                nominal = ["-"] * len(orden)
                for sigla, nombre, st in b["entradas"]:
                    m = padron.buscar(cam, sigla, nombre)
                    if not m or m["nombre"] in vistos:
                        sin += 1
                        continue
                    vistos.add(m["nombre"])
                    nominal[idx[m["nombre"]]] = codigo_voto(st)
                    r = miembros[(cam, m["nombre"])]
                    if b["tipo"] == "asistencia":
                        r["pases"] += 1
                        r["presente" if st in PRESENTE else "ausente" if st in AUSENTE else "licencia"] += 1
                    else:
                        r["votaciones"] += 1
                        v = VOTO.get(st)
                        r[v if v in ("si", "no", "abst") else "no_voto"] += 1
                        if v in ("si", "no", "abst"):
                            emitidos.append((r, m.get("sigla", "—"), v))
                        por_bancada[m.get("sigla", "—")][v or "ausente"] += 1
                cal["nombres_sin_cruce"] += sin
                # Posición de cada bancada = voto mayoritario de sus miembros (si/no/abst).
                posicion = {}
                for sg, c in por_bancada.items():
                    top = sorted(((c.get(k, 0), k) for k in ("si", "no", "abst")), reverse=True)
                    if top[0][0] and top[0][0] > top[1][0]:
                        posicion[sg] = top[0][1]
                for r, sg, v in emitidos:
                    if sg in posicion:
                        r["con_bancada" if v == posicion[sg] else "contra_bancada"] += 1
                if b["tipo"] == "asistencia":
                    pases += 1
                else:
                    o = b["oficial"]
                    vid = vid0 = f"{cam}-{b['fecha'].replace('-', '')}-{_hhmm(b['hora'])}"
                    k = 1
                    while vid in ids_usados:
                        vid = vid0 + "bcdefghijklmnopqrstuvwxyz"[k - 1]
                        k += 1
                    ids_usados.add(vid)
                    votaciones.append({
                        "id": vid,
                        "fecha": b["fecha"], "hora": b["hora"], "asunto": b["asunto"],
                        "si": o["si"], "no": o["no"], "abst": o["abst"],
                        "por_bancada": {k: dict(v) for k, v in sorted(por_bancada.items())},
                        "posicion": dict(sorted(posicion.items())),
                        "votos": "".join(nominal),
                    })
        salida["camaras"][cam] = {
            "pases_lista": pases,
            "votaciones": sorted(votaciones, key=lambda v: (v["fecha"], v["hora"]), reverse=True),
            "sesiones": [{"fecha": f, **s} for f, s in sorted(sesiones.items(), reverse=True)],
            "nominal_orden": orden,
        }
        salida["calidad"][cam] = dict(cal)
        print(f"    {pases} pases de lista · {len(votaciones)} votaciones · {dict(cal)}", file=sys.stderr)

    lista = []
    for r in miembros.values():
        # Sobre los pases sin licencia: la licencia (viaje, enfermedad, oficial…) no es falta.
        base = r["presente"] + r["ausente"]
        r["pct_asistencia"] = round(r["presente"] / base * 100, 1) if base else None
        lista.append(r)
    salida["miembros"] = sorted(lista, key=lambda r: (r["camara"], r["nombre"]))
    salida["meta"] = {
        "generado": date.today().isoformat(),
        "fuente": "Reportes de asistencia y votación del Pleno (PDF) · diputados/senado.congreso.gob.pe",
        "nota": "Pases de lista y votaciones validados contra el total oficial al pie de cada bloque; "
                "los escaneos se leen con OCR. Licencias (viaje, enfermedad, oficial…) no cuentan como ausencia.",
        "votos": "votaciones[].votos: un carácter por congresista en el orden de camaras[cam].nominal_orden "
                 "(S sí, N no, A abstención, X ausente, L licencia, R sin respuesta, P presente, - sin dato).",
    }
    return salida


def main() -> int:
    data = build()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"[ok] {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
