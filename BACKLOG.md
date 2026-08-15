# BACKLOG — Congreso Abierto Perú

Backlog vivo del observatorio. Al cerrar una tarea: marcar `[x]`, agregar las que
surjan, y commitear. Prioridad de arriba hacia abajo.

> Norte: pasar de "dashboard de datos" a **herramienta de fiscalización** — cruzar
> quién legisla, cuánto cuesta, quién trabaja ahí y quién le vende al Congreso.

---

## ✅ Hecho

- [x] Scraper de **Proyectos de Ley** (API oficial SPLEY) — histórico por periodo.
- [x] Dashboard estático en GitHub Pages (Resumen, Proyectos, Presupuesto, Comisiones, Análisis).
- [x] **Presupuesto** del Congreso (MEF Consulta Amigable, Playwright).
- [x] Cruce **Comisiones × proyectos** (dato real API).
- [x] **Personal del Congreso** — planilla nominal real del PTE (`id_entidad=16`):
  scraper `pipeline/scrapers/personal_pte.py` + agregador `web/build_personal.py`
  + sección con régimen, distribución de sueldos, cargos, top sueldos y pensiones.
  (2026-07: 3,515 activos + 536 pensionistas · masa S/27.7 M/mes.)

---

## 🔜 Próximo (alto valor de fiscalización)

- [ ] **Contratos / proveedores del Congreso** (OCDS/SEACE) — quién le vende al
  Congreso, montos, concentración por proveedor. Fuente: bulk mensual OCDS
  (`contratacionesabiertas.oece.gob.pe/api/v1/file/seace_v3/csv/AAAA/MM/`).
  Cruzar comprador = Congreso. Sección "Contratos" en el sitio.
- [ ] **Asesores por congresista** — la planilla PTE ya trae la dependencia; en
  varios casos es el despacho/comisión. Cruzar con el **padrón de 130 congresistas
  + bancada** para atribuir asesores a cada despacho y detectar contrataciones
  polémicas (familiares, sancionados, sin perfil).
- [ ] **Padrón de congresistas** (130) con bancada, foto, votos y producción —
  base para casi todos los cruces. Fuente: directorio oficial + SPLEY autores.
- [ ] **Enriquecer personal con cheka** (`apicheck.tunky.net`): expediente,
  trayectoria interinstitucional, sanciones RNSSC y DJ de intereses por persona.

## 🧭 Fiscalización avanzada

- [ ] **Votaciones nominales** — parsing de actas (PDF/HTML) → voto por congresista;
  votaciones más polémicas; afinidad entre bancadas.
- [ ] **Asistencias y licencias** por sesión.
- [ ] **Tramitación de proyectos** (timeline por etapas) + descarga de PDF.
- [ ] **Cruce integridad**: personal/proveedores vs **sanciones RNSSC**,
  **DJ de bienes y rentas** e **inhabilitaciones**.
- [ ] **Serie histórica de planilla** (varios meses/años del PTE) → detección de
  incrementos atípicos y crecimiento del gasto en personal.
- [ ] **Costo por ley aprobada** (presupuesto ÷ leyes) y productividad por sol.

## 🏗️ Plataforma / calidad

- [ ] **Buscador de personal** (nombre/cargo/dependencia) en el front (shards por letra).
- [ ] Snapshot de personal versionado + `actualizar_personal.sh` (refresco laptop).
- [ ] Automatizar refresco de personal (launchd, IP residencial — PTE geobloquea CI).
- [ ] Página/pestaña **Metodología y fuentes** (anti-overclaiming, cobertura por dato).
- [ ] OG dinámico con la cifra de masa salarial + tarjeta compartible de Personal.
- [ ] API Open Data documentada (OpenAPI): `/congresistas`, `/proyectos`, `/personal`, `/contratos`.
- [ ] Tests del pipeline + CI lint.

---

## Notas operativas

- **Personal (PTE) se refresca desde la laptop**, no en CI: el Portal de
  Transparencia bloquea IPs de datacenter (GitHub Actions). Correr
  `./actualizar_personal.sh` y commitear `web/personal.json`.
- **Legislativo + presupuesto** sí se regeneran en CI (cron diario en `pages.yml`).
- Anti-overclaiming: una fuente solo pasa a ✅ tras un request real verificado.
  Estado por fuente en [`docs/DATA_SOURCES.md`](./docs/DATA_SOURCES.md).
