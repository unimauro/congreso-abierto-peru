# Backend — Ruby on Rails API (Fase 4)

API y orquestación. Stack objetivo: Rails (API-only) + Sidekiq + Redis.

Responsabilidades:
- Open Data API documentada con OpenAPI: /congresistas, /proyectos, /votaciones,
  /comisiones, /personal, /gastos (con filtros avanzados).
- Orquestación de los scrapers del pipeline (jobs diarios con Sidekiq).
- Detección de cambios y sistema de alertas.

Aún no inicializado. Cuando arranque la Fase 4:

```bash
rails new . --api --database=postgresql --skip-test
bundle add sidekiq redis
```

Mientras tanto, el pipeline (Python) puede correr de forma autónoma vía cron.
