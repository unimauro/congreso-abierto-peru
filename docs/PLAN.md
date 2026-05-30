# Plan del proyecto — Congreso Abierto Perú

> Observatorio Inteligente del Congreso de la República del Perú.
> Transparencia, análisis de datos y monitoreo legislativo con datos públicos.

Este plan está ordenado por **fattibilidad de scraping**: primero lo que ya se
puede recolectar hoy con fuentes verificadas, después lo que requiere más trabajo
de ingeniería, y al final las capas de producto (IA, predictivo, infra cloud).

**Principio rector (anti-overclaiming):** no se documenta una fuente como
"disponible" hasta haber confirmado un endpoint real que responde. El estado de
cada fuente vive en [`DATA_SOURCES.md`](./DATA_SOURCES.md).

---

## Fase 0 — Fundaciones (en curso)

- [x] Estructura del monorepo
- [x] Licencia AGPL-3.0
- [x] Verificación de fuentes scrapeables reales
- [x] Scraper funcional de **Proyectos de Ley** (prueba de concepto real)
- [ ] `docker-compose` con PostgreSQL + Redis
- [ ] Esquema base de datos (modelo en [`DATA_MODEL.md`](./DATA_MODEL.md))
- [ ] CI: lint + tests del pipeline

---

## Fase 1 — Actividad legislativa scrapeable HOY ⭐ (prioridad del usuario)

Lo que ya tiene endpoint confirmado o ruta de scraping clara.

### 1.1 Proyectos de Ley — ✅ API confirmada
- Fuente: `api.congreso.gob.pe/spley-portal-service/proyecto-ley/lista-con-filtro`
- Datos: número, estado, fecha de presentación, título, proponente, **autores**.
- Cobertura histórica: por `perParId` (periodo parlamentario): 2021, 2016, 2011, 2006… → cubre +10 años.
- Estado: **scraper implementado** en `pipeline/scrapers/proyectos_ley.py`.
- Pendiente: detalle de expediente (tramitación/timeline por etapas) y descarga de PDF.

### 1.2 Comisiones
- Integrantes, sesiones, proyectos dictaminados.
- Ruta: portal de comisiones + datos abiertos por comisión (HTML/CSV sueltos).
- Estado: por implementar (scraper HTML).

### 1.3 Presupuesto / Gasto del Congreso
- Ejecución presupuestal, gasto anual, viajes, contrataciones.
- Fuentes: **MEF Consulta Amigable** (pliego Congreso) + **PTE** (id_entidad=16).
- Estado: por implementar (POST aspx en MEF; descargas en PTE).

> **Entregable de Fase 1:** un Data Warehouse con proyectos de ley de los últimos
> 10 años + presupuesto anual + estructura de comisiones, consultable y exportable.

---

## Fase 2 — Actividad de detalle (más ingeniería de scraping)

- **Votaciones**: PDFs/HTML de actas → parsing por congresista (voto SÍ/NO/ABST).
- **Asistencias y licencias**: registros por sesión.
- **Diario de Debates**: actas (PDF) → texto → intervenciones por congresista.
- **Tramitación de proyectos**: timeline por etapas (comisión → dictamen → debate → votaciones).
- **Personal / Consulta de Personal**: planillas CAS, clasificación (asesores, técnicos, etc.).

---

## Fase 3 — Modelo de datos unificado y Data Warehouse histórico

- Normalización en PostgreSQL (OLTP) + ClickHouse (OLAP / agregados históricos).
- Resolución de identidades (mismo congresista entre periodos, cambios de bancada).
- Indicadores derivados: productividad, participación, transparencia, influencia.
- Series temporales de presupuesto y personal con detección de incrementos atípicos.

---

## Fase 4 — Producto (frontend + API)

- **Frontend** Next.js + React + TS + Tailwind + shadcn (dashboards ejecutivos,
  módulos de congresistas/bancadas/proyectos/votaciones/comisiones/personal/presupuesto).
- **Backend API** Rails + Sidekiq + Redis (orquestación de scrapers, jobs diarios).
- **Open Data API** documentada con OpenAPI: `/congresistas`, `/proyectos`, `/votaciones`, etc.
- Modo claro/oscuro, responsive, búsqueda global, filtros avanzados.

---

## Fase 5 — Inteligencia y analítica avanzada

- **RAG** sobre el corpus (pgvector): preguntas en lenguaje natural con citas a fuentes oficiales.
- **Análisis de grafos**: alianzas de votación, coincidencia entre bancadas.
- **Modelos predictivos**: probabilidad de aprobación, asistencia, afinidad política.
- **Sistema de alertas**: cambios de bancada, aprobaciones, incrementos de gasto, contrataciones inusuales.

---

## Fase 6 — Infraestructura productiva

- Dockerización completa de todos los servicios.
- Kubernetes + despliegue en AWS.
- Scheduling diario de scrapers (detección de cambios) con Sidekiq/cron.
- Escalabilidad para millones de registros históricos.

---

## Mapa de stack por fase

| Capa | Tecnología | Fase |
|---|---|---|
| Scraping/ETL | Python, requests/httpx, Playwright, Pandas | 1–2 |
| OLTP | PostgreSQL | 1 |
| OLAP/DW | ClickHouse | 3 |
| Vector DB | pgvector | 5 |
| Backend API | Ruby on Rails, Sidekiq, Redis | 4 |
| Frontend | Next.js, React, TS, Tailwind, shadcn | 4 |
| IA | RAG, embeddings, grafos, ML | 5 |
| Infra | Docker, Kubernetes, AWS | 6 |
