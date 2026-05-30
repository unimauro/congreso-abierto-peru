# Pipeline — scrapers y ETL

Recolección de datos públicos del Congreso del Perú en Python.

## Instalación

```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Scrapers disponibles

### Proyectos de Ley ✅ (funcional)

API oficial verificada (`api.congreso.gob.pe/spley-portal-service`).

```bash
# Vista rápida (no guarda)
python -m pipeline.scrapers.proyectos_ley --periodos 2021 --limit 5

# Descargar histórico (10+ años) a ./data
python -m pipeline.scrapers.proyectos_ley --periodos 2021 2016 2011 --out ../data
```

Genera `proyectos_ley_<periodo>.json` y `.csv` con: número, código, estado,
fecha de presentación, título, proponente y lista de autores.

## Cargar a PostgreSQL

```bash
docker compose up -d postgres          # crea el esquema (warehouse/migrations)
export DATABASE_URL=postgresql://congreso:congreso@localhost:5432/congreso_abierto
python -m pipeline.etl.load_proyectos ../data/proyectos_ley_2021.json
```

El upsert es idempotente por `(periodo, numero)`: re-ejecutar no duplica y
actualiza el estado (útil para detección de cambios diaria).

## Por implementar (ver `docs/PLAN.md`)

- Comisiones (HTML)
- Presupuesto: MEF Consulta Amigable (POST aspx) + PTE
- Votaciones, asistencias, diario de debates (PDF parsing)
- Personal / CAS (PTE)

## Convenciones

- Cada scraper normaliza a `@dataclass` y separa *fetch* de *persistencia*.
- HTTP centralizado en `common/http.py` (reintentos + backoff + UA de navegador).
- Idempotencia y trazabilidad (`fetched_at`, `fuente`) en todos los registros.
