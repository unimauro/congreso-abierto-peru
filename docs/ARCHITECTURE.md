# Arquitectura

## Flujo de datos

1. **Ingesta (Python).** Scrapers por fuente (API JSON, HTML, PDF). Cada scraper
   normaliza a dataclasses y escribe a PostgreSQL (idempotente, con detección de cambios).
2. **ETL (Python/Pandas).** Limpieza, resolución de identidades (congresistas entre
   periodos, cambios de bancada), cálculo de indicadores derivados.
3. **OLTP (PostgreSQL).** Verdad transaccional + pgvector para embeddings.
4. **DW (ClickHouse).** Agregados históricos y series temporales para dashboards.
5. **API (Rails + Sidekiq + Redis).** Expone Open Data API y orquesta los jobs
   diarios de scraping (cron/Sidekiq). Detecta cambios y dispara alertas.
6. **Frontend (Next.js).** Dashboards y módulos; consume la API.

## Principios

- **Idempotencia:** re-ejecutar un scraper no duplica; hace upsert por clave natural
  (`periodo` + `numero` para proyectos).
- **Trazabilidad:** cada registro guarda su fuente y `fetched_at`.
- **Detección de cambios:** comparación contra el último snapshot → alertas.
- **Escalabilidad histórica:** ClickHouse para millones de filas; PostgreSQL para el
  estado vivo.
- **Anti-overclaiming:** ninguna fuente se publica como disponible sin endpoint probado.

## Orquestación (objetivo)

- Sidekiq worker por fuente, agendado diariamente.
- Redis como broker y cache de la API.
- Reintentos con backoff; circuit-breaker si una fuente cambia de estructura.

## Despliegue (Fase 6)

Docker Compose para desarrollo; Kubernetes + AWS para producción
(deployments por servicio, CronJobs para scrapers, RDS PostgreSQL,
ClickHouse gestionado o en nodo dedicado).
