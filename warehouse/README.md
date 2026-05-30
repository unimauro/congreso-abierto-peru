# Data Warehouse

- `migrations/`: DDL de PostgreSQL (OLTP). Se ejecuta automáticamente al levantar
  el contenedor `postgres` de docker-compose.
- ClickHouse (OLAP / agregados históricos) se añade en la Fase 3.

Ver el modelo en `docs/DATA_MODEL.md`.
