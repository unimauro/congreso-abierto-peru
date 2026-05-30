"""HTTP client compartido para los scrapers.

Sesión con reintentos, backoff y User-Agent de navegador. Los servicios del
Congreso redirigen 301 de `wb2server.congreso.gob.pe` a `api.congreso.gob.pe`,
así que seguimos redirecciones por defecto.
"""
from __future__ import annotations

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def build_session(timeout: int = 30) -> requests.Session:
    """Crea una sesión con reintentos automáticos y headers de navegador."""
    session = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(
        {
            "User-Agent": DEFAULT_UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "es-PE,es;q=0.9",
        }
    )
    # Guardamos el timeout para que los callers lo usen explícitamente.
    session.request_timeout = timeout  # type: ignore[attr-defined]
    return session
