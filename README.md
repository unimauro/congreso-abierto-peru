# Congreso Abierto Perú 🇵🇪

> Observatorio Inteligente del Congreso de la República del Perú.
> Transparencia, análisis de datos y monitoreo legislativo a partir de datos públicos.

Plataforma de datos abiertos para que **periodistas, ciudadanía, investigadores,
universidades y organizaciones civiles** entiendan cómo funciona realmente el
Congreso: cuánto cuesta, quién produce resultados y cómo votan los congresistas.

[![Licencia: AGPL v3](https://img.shields.io/badge/Licencia-AGPL%20v3-blue.svg)](./LICENSE)

---

## Estado del proyecto

🚧 **En construcción.** Arrancamos por lo que **ya se puede scrapear hoy** con
fuentes oficiales verificadas, y avanzamos por fases. Ver el plan completo en
[`docs/PLAN.md`](./docs/PLAN.md).

**Lo que ya funciona:**
- ✅ Scraper de **Proyectos de Ley** (API oficial confirmada) — descarga el histórico
  completo por periodo parlamentario (+10 años vía `perParId`).

Probado en vivo: 14,704 proyectos del periodo 2021–2026 con número, estado, fecha,
título, proponente y autores.

```bash
cd pipeline
pip install -r requirements.txt
python -m pipeline.scrapers.proyectos_ley --periodos 2021 2016 --out ../data
```

---

## Preguntas que la plataforma busca responder

¿Cuánto cuesta el Congreso? · ¿Cuántos trabajadores tiene? · ¿Cuánto gasta cada
comisión? · ¿Qué congresistas presentan/aprueban más proyectos? · ¿Qué partidos son
más efectivos? · ¿Cómo vota cada congresista? · ¿Cuáles son las votaciones más
polémicas? · ¿Cuál es el costo aproximado por ley aprobada?

---

## Arquitectura (objetivo)

```
                 ┌─────────────────────────────────────────────┐
 Fuentes  ─────▶ │  Pipeline (Python: scrapers + ETL)           │
 oficiales       │  requests/httpx · BeautifulSoup · Playwright │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                    PostgreSQL (OLTP) ──▶ ClickHouse (DW / OLAP)
                                 │              + pgvector (RAG)
                                 ▼
                 Backend API (Rails + Sidekiq + Redis)
                                 ▼
                 Frontend (Next.js + React + TS + Tailwind + shadcn)
```

Detalle por capa en [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Estructura del repo

| Carpeta | Contenido | Fase |
|---|---|---|
| `pipeline/` | Scrapers y ETL en Python | 1–2 ✅ inicio |
| `warehouse/` | DDL de PostgreSQL y ClickHouse | 3 |
| `backend/` | API Rails + Sidekiq (orquestación, jobs) | 4 |
| `frontend/` | Next.js (dashboards y módulos) | 4 |
| `infra/` | Docker, Kubernetes, AWS | 6 |
| `docs/` | Plan, fuentes, modelo de datos, arquitectura | — |

## Documentación

- 📋 [Plan por fases](./docs/PLAN.md)
- 🔌 [Fuentes de datos (estado verificado)](./docs/DATA_SOURCES.md)
- 🗃️ [Modelo de datos](./docs/DATA_MODEL.md)
- 🏗️ [Arquitectura](./docs/ARCHITECTURE.md)

## Licencia

[AGPL-3.0](./LICENSE) — software libre copyleft. Cualquier despliegue como servicio
debe liberar su código fuente. Los **datos** recolectados son información pública del
Estado peruano.

> Proyecto cívico independiente. No afiliado al Congreso de la República del Perú.
