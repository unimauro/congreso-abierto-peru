"""Texto completo de los proyectos de ley 2026–2031 (Diputados, Senado y Congreso).

Para cada proyecto de web/bicameral.json:
  1. Pide el expediente al portal (spley-portal-service). El portal cifra periodo y
     número en la URL con AES-128-ECB + base64url (es su propia codificación del lado
     del cliente, `encryptionService.encrypt` en su bundle JS; la clave es pública).
  2. Elige el PDF del proyecto: el archivo del seguimiento más antiguo (no el "[R]",
     que es el decreto de envío).
  3. Extrae el texto con `pdftotext -layout`; si sale casi vacío (escaneo) hace OCR de
     las 6 primeras páginas con pdftoppm + tesseract (spa).

El texto completo se cachea en data/textos/{codigo}.json (gitignored). Un PDF ya
cacheado no se vuelve a bajar; solo se refresca la metadata del expediente de los
proyectos con menos de 30 días.

Salida compacta (sin texto completo): web/textos.json con, por proyecto, objeto
(Artículo 1), leyes que modifica, efecto fiscal declarado, páginas, palabras y
términos distintivos (TF-IDF propio, sin sklearn); y por congresista (autor), sus
términos distintivos y las leyes que más toca.

    python -m pipeline.scrapers.textos_ley            # incremental
    python -m pipeline.scrapers.textos_ley --solo-salida   # sin red: rehace textos.json
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from pipeline.common.http import build_session  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, "data", "textos")
BICAMERAL = os.path.join(RAIZ, "web", "bicameral.json")
OUT = os.path.join(RAIZ, "web", "textos.json")

API = "https://api.congreso.gob.pe/spley-portal-service"
PORTAL = "https://wb2server.congreso.gob.pe/spley-portal/#/{ruta}/expediente/2026/{numero}"
RUTA_CAMARA = {"D": "diputados", "S": "senado", "C": "congreso"}
PERIODO = 2026
CLAVE = b"ProdALg5ZrAsxBMD"  # clave pública del portal (client-side)
WORKERS = 4
PAUSA = 0.4
DIAS_REFRESCO = 30
MIN_TEXTO = 1500
OCR_PAGINAS = 6


# ---------------------------------------------------------------- red

def enc(x) -> str:
    c = AES.new(CLAVE, AES.MODE_ECB).encrypt(pad(str(x).encode(), 16))
    return base64.urlsafe_b64encode(c).decode().rstrip("=")


def url_pdf(archivo_id) -> str:
    return f"{API}/archivo/{base64.b64encode(str(archivo_id).encode()).decode()}/pdf"


def url_portal(numero: int, camara: str) -> str:
    return PORTAL.format(ruta=RUTA_CAMARA.get(camara, "diputados"), numero=numero)


_local = threading.local()


def sesion():
    if not hasattr(_local, "s"):
        _local.s = build_session(timeout=60)
    return _local.s


def get(url, **kw):
    ultimo = None
    for intento in range(3):
        try:
            r = sesion().get(url, timeout=90, **kw)
            r.raise_for_status()
            time.sleep(PAUSA)
            return r
        except Exception as e:  # noqa: BLE001
            ultimo = e
            time.sleep(3 * (intento + 1))
    raise ultimo  # type: ignore[misc]


def expediente(numero: int, camara: str) -> dict:
    r = get(f"{API}/expediente/{enc(PERIODO)}/{enc(numero)}", params={"codTipoParl": camara})
    d = r.json()
    return d.get("data") or {}


def meta_expediente(data: dict) -> dict:
    g = data.get("general") or {}
    seg = []
    for s in data.get("seguimientos") or []:
        seg.append({
            "fecha": (s.get("fecha") or "")[:10],
            "detalle": (s.get("detalle") or "")[:300],
            "archivos": [{"id": a.get("proyectoArchivoId"), "nombre": a.get("nombreArchivo"),
                          "fecha": a.get("fecha")} for a in s.get("archivos") or []],
        })
    return {
        "titulo": g.get("titulo"),
        "sumilla": g.get("sumilla"),
        "grupo": g.get("desGpar"),
        "presentado": g.get("fecPresentacion"),
        "estado": g.get("desEstado"),
        "proponente": g.get("desProponente"),
        "legislatura": g.get("desLegis"),
        # Sin DNI: solo nombre y tipo (1 = autor, 2 = coautor, 3 = adherente).
        "firmantes": [{"nombre": f.get("nombre"), "tipo": f.get("tipoFirmanteId")}
                      for f in data.get("firmantes") or []],
        "comisiones": [c.get("nombre") or c.get("desComision") or c.get("comision")
                       for c in data.get("estudioComisiones") or [] if isinstance(c, dict)],
        "seguimientos": seg,
    }


def elegir_pdf(meta: dict, codigo: str):
    """Archivo del proyecto: el del seguimiento más antiguo que no sea un '[R]'."""
    num = codigo.split("-")[0]
    cands = []
    for s in meta.get("seguimientos") or []:
        for a in s.get("archivos") or []:
            nom = (a.get("nombre") or "").upper()
            if not a.get("id") or "[R]" in nom or not nom.endswith(".PDF"):
                continue
            # Prioridad: nombre que cita el número del proyecto, luego el más antiguo.
            cita = 0 if num in nom and (nom.startswith("PL") or nom.startswith("PR")) else 1
            cands.append((cita, s.get("fecha") or "9999", a.get("fecha") or "9999", a["id"]))
    if not cands:
        return None
    cands.sort()
    return cands[0][3]


# ---------------------------------------------------------------- PDF → texto

def paginas_pdf(ruta: str) -> int:
    try:
        out = subprocess.run(["pdfinfo", ruta], capture_output=True, text=True, timeout=60).stdout
        m = re.search(r"^Pages:\s+(\d+)", out, re.M)
        return int(m.group(1)) if m else 0
    except Exception:  # noqa: BLE001
        return 0


OCR_FINALES = 4  # el análisis costo-beneficio y la fórmula legal suelen ir al final del escaneo


def ocr(ruta: str, paginas: int, desde: int = 1, hasta: int | None = None) -> str:
    textos = []
    hasta = hasta or min(OCR_PAGINAS, paginas or OCR_PAGINAS)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", "150", "-gray", "-f", str(desde), "-l", str(hasta),
                        "-png", ruta, os.path.join(tmp, "p")], capture_output=True, timeout=600)
        for img in sorted(os.listdir(tmp)):
            r = subprocess.run(["tesseract", os.path.join(tmp, img), "-", "-l", "spa", "--psm", "6"],
                               capture_output=True, text=True, timeout=600)
            textos.append(r.stdout)
    return "\f".join(textos)


def extraer(pdf: bytes):
    with tempfile.TemporaryDirectory() as tmp:
        ruta = os.path.join(tmp, "p.pdf")
        with open(ruta, "wb") as f:
            f.write(pdf)
        pags = paginas_pdf(ruta)
        r = subprocess.run(["pdftotext", "-layout", ruta, "-"], capture_output=True, timeout=600)
        texto = r.stdout.decode("utf-8", "replace")
        metodo = "pdftotext"
        if len(texto.strip()) < MIN_TEXTO:
            t2 = ocr(ruta, pags)
            if pags and pags > OCR_PAGINAS:  # también las últimas páginas
                t2 += "\f" + ocr(ruta, pags, max(OCR_PAGINAS + 1, pags - OCR_FINALES + 1), pags)
            if len(t2.strip()) > len(texto.strip()):
                texto, metodo = t2, "ocr"
    return texto, pags, metodo


# ---------------------------------------------------------------- caché

def ruta_cache(codigo: str) -> str:
    return os.path.join(CACHE, f"{codigo}.json")


def leer_cache(codigo: str):
    try:
        with open(ruta_cache(codigo), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def escribir_cache(codigo: str, d: dict):
    tmp = ruta_cache(codigo) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(tmp, ruta_cache(codigo))


def procesar(p: dict, hoy: date) -> str:
    codigo, camara = p["codigo"], p["camara"]
    numero = int(codigo.split("-")[0])
    c = leer_cache(codigo)
    reciente = False
    try:
        reciente = (hoy - date.fromisoformat(p.get("fecha") or "")).days < DIAS_REFRESCO
    except ValueError:
        pass
    tiene_texto = bool(c and c.get("text"))
    if tiene_texto and not reciente:
        return "cache"
    data = expediente(numero, camara)
    if not data.get("general"):
        return "sin-expediente"
    meta = meta_expediente(data)
    c = c or {"codigo": codigo, "camara": camara}
    c.update({"sumilla": meta.get("sumilla"), "expediente": meta, "meta_actualizada": hoy.isoformat()})
    if not tiene_texto:
        aid = elegir_pdf(meta, codigo)
        if aid:
            r = get(url_pdf(aid))
            if r.content[:4] == b"%PDF":
                texto, pags, metodo = extraer(r.content)
                c.update({"pdf_id": aid, "pdf_url": url_pdf(aid), "text": texto, "paginas": pags,
                          "metodo": metodo, "fetched": hoy.isoformat()})
    escribir_cache(codigo, c)
    return "nuevo" if c.get("text") and not tiene_texto else ("meta" if tiene_texto else "sin-pdf")


def descargar(proyectos: list, hoy: date):
    os.makedirs(CACHE, exist_ok=True)
    estados = Counter()
    errores = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(procesar, p, hoy): p["codigo"] for p in proyectos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                estados[fut.result()] += 1
            except Exception as e:  # noqa: BLE001
                estados["error"] += 1
                errores.append(f"{futs[fut]}: {e}")
            if i % 50 == 0:
                print(f"  {i}/{len(proyectos)} {dict(estados)} ({time.time() - t0:.0f}s)", flush=True)
    print(f"[textos] descarga: {dict(estados)} en {time.time() - t0:.0f}s")
    for e in errores[:10]:
        print("  [!]", e)


def completar_finales(c: dict) -> str:
    """Escaneos procesados antes de leer las páginas finales: baja el PDF otra vez y añade OCR del final."""
    pags = c.get("paginas") or 0
    if c.get("metodo") != "ocr" or c.get("ocr_final") or pags <= OCR_PAGINAS or not c.get("pdf_url"):
        return "no-aplica"
    r = get(c["pdf_url"])
    if r.content[:4] != b"%PDF":
        return "sin-pdf"
    with tempfile.TemporaryDirectory() as tmp:
        ruta = os.path.join(tmp, "p.pdf")
        with open(ruta, "wb") as f:
            f.write(r.content)
        extra = ocr(ruta, pags, max(OCR_PAGINAS + 1, pags - OCR_FINALES + 1), pags)
    c["text"] = (c.get("text") or "") + "\f" + extra
    c["ocr_final"] = True
    escribir_cache(c["codigo"], c)
    return "completado"


def completar_ocr_pendientes():
    pend = []
    for f in os.listdir(CACHE):
        if f.endswith(".json"):
            c = leer_cache(f[:-5])
            if c and c.get("metodo") == "ocr" and not c.get("ocr_final") and (c.get("paginas") or 0) > OCR_PAGINAS:
                pend.append(c)
    if not pend:
        return
    t0, estados = time.time(), Counter()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for i, r in enumerate(ex.map(lambda c: (completar_finales(c) if True else None), pend), 1):
            estados[r] += 1
            if i % 25 == 0:
                print(f"  OCR final {i}/{len(pend)} {dict(estados)} ({time.time() - t0:.0f}s)", flush=True)
    print(f"[textos] OCR de páginas finales: {dict(estados)} en {time.time() - t0:.0f}s")


# ---------------------------------------------------------------- análisis

def sin_tildes(s: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", s) if unicodedata.category(ch) != "Mn")


def limpiar(texto: str) -> str:
    """Quita encabezados/pies repetidos por página (nombre del despacho, decenio, 'Página x de y')."""
    paginas = texto.split("\f")
    if len(paginas) >= 3:
        cuenta = Counter()
        for pg in paginas:
            cuenta.update({re.sub(r"\s+", " ", ln).strip() for ln in pg.splitlines() if ln.strip()})
        umbral = max(2, int(0.4 * len(paginas)))
        repetidas = {ln for ln, n in cuenta.items() if n >= umbral and len(ln) < 160}
    else:
        repetidas = set()
    out = []
    for ln in texto.replace("\f", "\n").splitlines():
        k = re.sub(r"\s+", " ", ln).strip()
        if k in repetidas or re.match(r"^(p[áa]gina\s+)?\d+\s*(de|/)\s*\d+$", k, re.I) or re.match(r"^\d{1,3}$", k):
            continue
        if re.search(r"decenio de la|^\W*año de(l| la)\b", k, re.I):
            continue
        out.append(ln)
    return "\n".join(out)


RE_FORMULA = re.compile(r"F\s*[ÓO]\s*R\s*M\s*U\s*L\s*A\s+L\s*E\s*G\s*A\s*L", re.I)
RE_EXPO = re.compile(r"EXPOSICI[ÓO]N\s+DE\s+MOTIVOS", re.I)


RE_FIN_SIN_TITULO = re.compile(r"^\s*(?:EXPOSICI[ÓO]N|FUNDAMENT|ANTECEDENTES|POR\s+TANTO|I\.\s+[A-ZÁÉÍÓÚ]{4})", re.M)


def formula_legal(texto: str) -> str:
    m = RE_FORMULA.search(texto)
    if m:
        ini = m.end()
        e = RE_EXPO.search(texto, ini)
        fin = e.start() if e and e.start() > ini + 200 else min(len(texto), ini + 20000)
    else:  # sin título "FÓRMULA LEGAL" (p. ej. OCR): desde el inicio hasta la primera sección
        ini = 0
        e = RE_FIN_SIN_TITULO.search(texto, 300)
        fin = e.start() if e else min(len(texto), 8000)
    return texto[ini:fin]


RE_ART1 = re.compile(
    r"^[\s“\"'|«]*Art[íi]culo\s+(?:1\s*[°º]?(?!\d)|[úu]nico\b|primero\b)\s*[\.\-–:]*\s*(.*?)"
    r"(?=^[\s“\"'|«]*Art[íi]culo\s+(?:2\s*[°º]?(?!\d)|segundo\b)|^\s*DISPOSICI|^\s*POR TANTO|^\s*EXPOSICI|\Z)",
    re.I | re.M | re.S)
RE_ENCAB = re.compile(r"^[\W_]*(?:(?:del\s+)?objeto(?:\s+y\s+finalidad)?(?:\s+de\s+la\s+(?:ley|norma|resoluci[óo]n(?:\s+legislativa)?))?"
                      r"|finalidad|objeto de la presente ley)\s*[\.\-–:]*\s*", re.I)


RE_PRESENTE = re.compile(
    r"(?:la\s+)?presente\s+(?:ley|norma|resoluci[óo]n\s+legislativa|reforma\s+constitucional|propuesta(?:\s+legislativa)?)\s+"
    r"(?:tiene\s+(?:por|como)\s+(?:objeto|finalidad)\s+(?:de\s+)?|busca\s+|propone\s+)", re.I)
MAX_OBJETO = 260


def objeto(formula: str, texto: str) -> str:
    m = RE_ART1.search(formula) or RE_ART1.search(texto)
    if not m:
        return ""
    s = re.sub(r"\s+", " ", m.group(1)).strip()
    s = RE_ENCAB.sub("", s).strip(" .-–—:")
    # "La presente ley tiene por objeto modificar…" → "Modificar…" (ahorra espacio, mismo sentido)
    m2 = RE_PRESENTE.search(s[:60])
    if m2 and len(s) > m2.end() + 20:
        s = s[m2.end():]
        s = s[:1].upper() + s[1:]
    if len(s) > MAX_OBJETO:
        corte = s[:MAX_OBJETO].rsplit(" ", 1)[0]
        s = corte.rstrip(",;:") + "…"
    return s


RE_NORMA = re.compile(
    r"\b(Ley(?:\s+Org[áa]nica)?|Decreto\s+Legislativo|Decreto\s+Ley|Decreto\s+de\s+Urgencia|Decreto\s+Supremo|Resoluci[óo]n\s+Legislativa)"
    r"\s+(?:N\s*[°º\.o\?”\"]+\s*|n[úu]mero\s+)?(\d{1,3}(?:[\.,]\d{3})|\d{3,5}(?:-\d{4}(?:-[A-Z]{2,})?)?)(?![\d/])",
    re.I)


def norma_canonica(tipo: str, num: str) -> str:
    t = re.sub(r"\s+", " ", tipo).strip()
    t = {"ley": "Ley", "ley organica": "Ley Orgánica", "decreto legislativo": "Decreto Legislativo",
         "decreto ley": "Decreto Ley", "decreto de urgencia": "Decreto de Urgencia",
         "decreto supremo": "Decreto Supremo", "resolucion legislativa": "Resolución Legislativa"}.get(
        sin_tildes(t.lower()), t)
    if t == "Ley Orgánica":
        t = "Ley"
    num = num.replace(".", "").replace(",", "").upper()
    return f"{t} N° {num}"


def leyes(formula: str) -> list:
    vistas = []
    for m in RE_NORMA.finditer(formula):
        if re.search(r"proyecto\s+de\s*$", formula[max(0, m.start() - 14):m.start()], re.I):
            continue  # "Proyecto de Ley 5666/2023-CR" no es una ley
        n = norma_canonica(m.group(1), m.group(2))
        if n.startswith("Ley N° ") and not re.fullmatch(r"\d{4,5}", n[7:]):
            continue  # "Ley 30" etc. → ruido
        if n not in vistas:
            vistas.append(n)
        if len(vistas) >= 8:
            break
    return vistas


# Declaración de que no hay gasto: "no irroga gasto", "no genera ningún impacto presupuestal",
# "ningún costo fiscal", "sin demandar recursos adicionales", "no autoriza gastos adicionales"…
_OBJ_GASTO = (r"(?:gasto|gastos|costo|costos|egreso|erogaci\w*|impacto\s+(?:presupuest\w+|fiscal|economico\s+para\s+el\s+estado)"
              r"|recursos\s+(?:adicionales|publicos|del\s+tesoro)|transferencias?\s+presupuestari\w+|carga\s+(?:fiscal|presupuest\w+)"
              r"|mayor\w*\s+gasto|incidencia\s+presupuest\w+)")
NEG = re.compile(
    r"\bno\s+(?:se\s+)?(?:irrog|genera|ocasion|demand|implica|represent|conllev|requier|requerir|supon|origin|signific"
    r"|afecta|compromet|involucr|crea|hay\b|existe|tiene|autoriz|contempl|produc|incurr|increment|exig)\w*\s+"
    r"(?:\w+\s+){0,3}?(?!costo\s+social)" + _OBJ_GASTO
    + r"|\b(?:ningun|ninguna|sin|cero)\s+(?:\w+\s+){0,2}?" + _OBJ_GASTO
    + r"|sin\s+(?:demandar|irrogar|generar|requerir|ocasionar)\s+(?:\w+\s+){0,4}?(?:recursos|gasto|costo)"
    + r"|costo\s+cero|no\s+irroga\b")
COSTO_SEC = re.compile(r"an[aá]lisis\s+(?:de\s+)?(?:costo|costos)[\s\-–]*(?:y\s+)?beneficio", re.I)
POS = re.compile(
    r"\b(?:irroga\w*|demanda\w*|requiere|requerir\w*|implica\w*|genera\w*|ocasiona\w*|significa\w*|representa\w*|costo\s+estimado|asciende)"
    r"\s+(?:\w+\s+){0,4}?(?:gasto|costo|recursos|inversion|presupuesto|s/)"
    r"|s/\.?\s?\d[\d\.,]*\s*(?:millones)?|\d[\d\.,]*\s+millones\s+de\s+soles")


def efecto_fiscal(texto: str) -> str:
    """Lo que el proyecto declara sobre su costo (heurística, prioridad a la negación)."""
    t = re.sub(r"\s+", " ", sin_tildes(texto.lower()))
    if NEG.search(t):
        return "declara que no irroga gasto"
    m = COSTO_SEC.search(t)
    if m:
        sec = t[m.end():m.end() + 4000]
        for p in POS.finditer(sec):
            if not re.search(r"\bno\s+(?:\w+\s+){0,2}$", sec[max(0, p.start() - 20):p.start()]):
                return "reconoce costo"
    return "no menciona"


# ---------------------------------------------------------------- TF-IDF

STOP_ES = """
a acá ahí al algo algún alguna algunas alguno algunos allí ante antes aquel aquella aquellas aquello aquellos aquí así
aun aún bajo bien cada casi cierta ciertas cierto ciertos como cómo con contra cual cuál cuales cuáles cualquier cuando
cuándo cuanto cuánto de del desde donde dónde dos durante e el él ella ellas ello ellos en entre era eran es esa esas
ese eso esos esta está están estar estas este esto estos fue fueron ha había han hasta hay la las le les lo los más
me mediante menos mi mientras mismo misma mismos mismas mucho muchos muy nada ni ninguna ninguno no nos nosotros o
otra otras otro otros para pero poco por porque pues que qué quien quién quienes se sea sean según ser si sí sido sin
sino sobre solo sólo su sus tal también tan tanto te tiene tienen toda todas todo todos tras tu tus u un una unas uno
unos usted y ya cuya cuyo cuyas cuyos dicha dicho dichas dichos dentro fin forma manera parte través vez veces asimismo
además respecto caso casos así mismo tanto puede pueden podrá podrán deberá deben debe debiendo siendo sean será serán
han hacer hace hecho hechos tener contar cuenta cuentan existe existen siguiente siguientes primer primera primero
segundo segunda tercero tercera cuarto quinto sexto uno dos tres cuatro cinco seis siete ocho nueve diez cien mil
año años día días mes meses fecha actual actualmente nuevo nueva nuevos nuevas mayor mayores menor menores gran
grandes mejor mejores general generales nacional nacionales público pública públicos públicas
través acuerdo conforme relación materia marco efecto efectos base caso fin fines modo tipo medida medidas ámbito
""".split()

STOP_LEGAL = """
ley leyes artículo artículos articulo inciso incisos numeral numerales literal literales párrafo capítulo título
disposición disposiciones complementaria complementarias final finales transitoria transitorias modificatoria
derogatoria derogatorias única único congreso república proyecto proyectos proposición propuesta legislativa
legislativo legislativa diputado diputados diputada diputadas senador senadora senadores señor señora presente
presentes iniciativa grupo parlamentario bancada firma firmado firmas suscribe suscriben reglamento constitución
política perú peruano peruana estado norma normas normativa normativo vigente vigencia publicación diario oficial
peruano exposición motivos fórmula legal análisis costo beneficio impacto legislación nacional objeto finalidad
modificación modifica modifícase incorpórase incorpora incorporación deróga deroga derógase sustituye establece
establecer establécese aprueba apruébase dispone declárase declara declarar decreto supremo legislativo urgencia
resolución resoluciones reglamentación reglamentar reglamenta plazo días hábiles calendario poder ejecutivo
entidad entidades competente competentes institución instituciones órgano órganos función funciones mediante
acuerdo nacional política políticas gobierno vinculación agenda objetivo objetivos texto comisión comisiones
pleno cámara senado presidente presidenta lima dado casa diputación periodo período parlamentario
fundamento fundamentos jurídico jurídica jurídicos antecedentes problema problemática sustento propone
propuestas contenido presente señala señalan dispuesto previsto prevista términos término siguiente redacta
redactado redacción quedan queda quedará vigor entra entrará pertinente pertinentes correspondiente corresponda
corresponde respectivo respectiva necesario necesaria necesidad aplicación aplicable aplica ámbito sistema
derecho derechos persona personas mencionada mencionado citada citado precitada precitado referida referido
fuente elaboración elaborado propia cuadro gráfico tabla figura nota página pág disponible www http https gob pdf
html org com consulta consultado consultas recuperado url sitio web enlace sección numeral efectos efecto
costo costos beneficios gasto gastos tesoro erario irroga recursos financiamiento presupuesto presupuestal
ponen pone poner conservan conserva involucra involucran directamente indirectamente luce vacío grupos grupo
formulación formular actos acto altas alto altos alta realizar realiza realizan permite permiten permitir busca
buscan contar cuentan tienen debe deberán podrán deberá asimismo mencionar precisar precisa señalado señalada
legislativas remitidas aprobar aprueba modificar incorporar incorporar derogar sustituir esperanza fortalecimiento
democracia democrático
""".split()


def clave(tok: str) -> str:
    return sin_tildes(tok.lower())


class Vocab:
    def __init__(self, nombres: set):
        self.stop = {clave(w) for w in STOP_ES + STOP_LEGAL} | nombres
        self.formas = defaultdict(Counter)  # clave → formas con tildes

    def tokens(self, texto: str) -> list:
        """Unigramas + bigramas de palabras contiguas (ninguna stopword)."""
        out = []
        prev = None
        for m in re.finditer(r"[A-Za-zÁÉÍÓÚÑÜáéíóúñü]+", texto):
            orig = m.group(0)
            w = orig.lower()
            k = clave(w)
            corto = len(k) < 4 and not (len(k) == 3 and orig.isupper())
            if corto or k in self.stop or len(set(k)) <= 2 or not re.search(r"[aeiou]", k[:4]):
                prev = None
                continue
            self.formas[k][w] += 1
            out.append(k)
            if prev is not None and m.start() - prev[1] <= 2:
                out.append(prev[0] + " " + k)
            prev = (k, m.end())
        return out

    def mostrar(self, term: str) -> str:
        return " ".join(self.formas[k].most_common(1)[0][0] if self.formas[k] else k for k in term.split())


def tfidf(docs: dict, vocab: Vocab):
    """docs: codigo → texto. Devuelve codigo → {term: peso} normalizado (L2) y df."""
    tf = {c: Counter(vocab.tokens(t)) for c, t in docs.items()}
    df = Counter()
    for cnt in tf.values():
        df.update(cnt.keys())
    n = len(docs)
    idf = {t: math.log((n + 1) / (d + 1)) + 1 for t, d in df.items()}
    vec = {}
    for c, cnt in tf.items():
        v = {}
        for t, f in cnt.items():
            if f < 2 or df[t] < 2 or df[t] > 0.25 * n:  # ≥2 veces aquí, en ≥2 proyectos, no demasiado común
                continue
            peso = (1 + math.log(f)) * idf[t]
            if " " in t:
                peso *= 1.5  # preferir bigramas
            v[t] = peso
        norma = math.sqrt(sum(x * x for x in v.values())) or 1
        vec[c] = {t: x / norma for t, x in v.items()}
    return vec, df, tf, idf


def top_terms(v: dict, k: int, vocab: Vocab) -> list:
    elegidos = []
    for t, _ in sorted(v.items(), key=lambda x: -x[1]):
        partes = set(t.split())
        if any(partes <= set(e.split()) or set(e.split()) <= partes for e in elegidos):
            continue  # no repetir "radiodifusión" si ya está "radiodifusión pública"
        elegidos.append(t)
        if len(elegidos) >= k:
            break
    return [vocab.mostrar(t) for t in elegidos]


# ---------------------------------------------------------------- salida

def _norm(s: str) -> list:
    return re.findall(r"[a-z0-9]+", sin_tildes(s.lower()))


def redundante(obj: str, sumilla: str) -> bool:
    """True si el objeto casi repite la sumilla (≥85 % de sus palabras están en ella)."""
    a, b = _norm(obj.rstrip("…")), set(_norm(sumilla))
    return bool(a) and sum(w in b for w in a) / len(a) >= 0.85


def construir(proyectos: list, congresistas: list, hoy: date):
    nombres = set()
    for c in congresistas:
        for campo in ("nombre", "bancada"):
            for w in re.findall(r"[a-záéíóúñü]+", (c.get(campo) or "").lower()):
                nombres.add(clave(w))
    caches = {}
    for p in proyectos:
        c = leer_cache(p["codigo"])
        if c:
            caches[p["codigo"]] = c
            for f in (c.get("expediente") or {}).get("firmantes") or []:
                for w in re.findall(r"[a-záéíóúñü]+", (f.get("nombre") or "").lower()):
                    nombres.add(clave(w))
    vocab = Vocab(nombres)
    limpios = {cod: limpiar(c["text"]) for cod, c in caches.items() if c.get("text")}
    vec, df, tf, idf = tfidf(limpios, vocab)
    n_docs = len(limpios)

    salida_p = []
    por_autor = defaultdict(list)
    for p in proyectos:
        cod = p["codigo"]
        c = caches.get(cod) or {}
        numero = int(cod.split("-")[0])
        e = {"codigo": cod, "camara": p["camara"],
             "sumilla": c.get("sumilla") or (c.get("expediente") or {}).get("sumilla") or p.get("titulo"),
             "expediente": url_portal(numero, p["camara"])}
        if cod in limpios:
            t = limpios[cod]
            fl = formula_legal(t)
            e.update({
                "pdf": c.get("pdf_url"),
                "objeto": objeto(fl, t),  # se vacía abajo si repite la sumilla
                "leyes_modificadas": leyes(fl),
                "efecto_fiscal": efecto_fiscal(t),
                "paginas": c.get("paginas"),
                "palabras": len(re.findall(r"\w+", t)),
                "terminos": top_terms(vec.get(cod, {}), 8, vocab),
            })
            if e["objeto"] and redundante(e["objeto"], e["sumilla"] or ""):
                e["objeto"] = "="  # "=" → el Artículo 1 dice lo mismo que la sumilla
            if c.get("metodo") == "ocr":
                e["ocr"] = True
            if p.get("autor"):
                por_autor[p["autor"]].append(cod)
        salida_p.append(e)

    camara_de = {c["nombre"]: c.get("camara") for c in congresistas}
    idx = {e["codigo"]: e for e in salida_p}
    salida_c = []
    for nombre, cods in sorted(por_autor.items()):
        # Se suman los conteos de todos sus proyectos (un "documento autor") y se pondera con
        # el idf del corpus; un término presente en varios de sus proyectos pesa más.
        acum, presencia = Counter(), Counter()
        for cod in cods:
            acum.update(tf.get(cod, {}))
            presencia.update(tf.get(cod, {}).keys())
        score = {}
        for t, f in acum.items():
            if f < 3 or df[t] < 2 or df[t] > 0.25 * n_docs:
                continue
            score[t] = (1 + math.log(f)) * idf[t] * (1.5 if " " in t else 1) * (1 + 0.3 * (presencia[t] - 1))
        lc = Counter(l for cod in cods for l in idx[cod].get("leyes_modificadas", []))
        salida_c.append({
            "nombre": nombre, "camara": camara_de.get(nombre),
            "terminos": top_terms(score, 12, vocab),
            "leyes_mas_modificadas": [l for l, _ in lc.most_common(5)],
            "n_textos": len(cods),
        })

    con_texto = len(limpios)
    return {
        "meta": {
            "generado": hoy.isoformat(),
            "cobertura": {"con_texto": con_texto, "total": len(proyectos),
                          "ocr": sum(1 for e in salida_p if e.get("ocr"))},
            "fuente": "api.congreso.gob.pe/spley-portal-service (expediente y PDF del proyecto)",
            "nota": ("Texto extraído del PDF del proyecto (pdftotext; OCR de las 6 primeras páginas si es escaneo). "
                     "objeto = Artículo 1 de la fórmula legal (\"=\" si repite la sumilla; vacío si no se encontró); leyes_modificadas = normas citadas en la fórmula legal; "
                     "efecto_fiscal = lo que el propio proyecto declara (heurística sobre el análisis costo-beneficio); "
                     "terminos = TF-IDF sobre todos los textos del periodo."),
        },
        "proyectos": salida_p,
        "congresistas": salida_c,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo-salida", action="store_true", help="no descargar; rehacer web/textos.json desde la caché")
    ap.add_argument("--limite", type=int, default=0, help="procesar solo N proyectos (pruebas)")
    args = ap.parse_args()
    hoy = date.today()
    with open(BICAMERAL, encoding="utf-8") as f:
        bic = json.load(f)
    proyectos = bic.get("proyectos") or []
    if args.limite:
        proyectos = proyectos[: args.limite]
    if not proyectos:
        sys.exit("[textos] bicameral.json sin proyectos")
    if not args.solo_salida:
        descargar(proyectos, hoy)
        completar_ocr_pendientes()
    out = construir(proyectos, bic.get("congresistas") or [], hoy)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    m = out["meta"]["cobertura"]
    print(f"[textos] {OUT}: {m['con_texto']}/{m['total']} con texto ({m['ocr']} por OCR), "
          f"{len(out['congresistas'])} congresistas, {os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main()
