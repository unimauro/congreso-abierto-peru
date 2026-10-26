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
- [x] **Materias / tipos de ley** — clasificador por palabras clave del título
  (`clasificar_materia` en build_data.py) + sección en Análisis. Hallazgo:
  **20.8% de los proyectos son declarativos/simbólicos** (3,089).
- [x] **Buscador de personal** — directorio nominal completo (4,051) por nombre,
  cargo, dependencia y régimen, con paginación.
- [x] **Nuevo periodo 2026–2031** detectado (instalado 27-jul-2026, 0 proyectos aún);
  nota en el sitio. El análisis sigue sobre el periodo 2021–2026.
- [x] **Pipeline diario auto-commit** (`pages.yml`): regenera data.json, commitea si
  cambió y despliega. El commit diario **mantiene el cron vivo** (ya no se desactiva
  por inactividad) y el historial de commits es el registro de actualizaciones.
- [x] **Vista "Estado de datos"**: frescura + fuente por dataset con semáforo.
- [x] **Personal del Congreso** — planilla nominal real del PTE (`id_entidad=16`):
  scraper `pipeline/scrapers/personal_pte.py` + agregador `web/build_personal.py`
  + sección con régimen, distribución de sueldos, cargos, top sueldos y pensiones.
  (2026-07: 3,515 activos + 536 pensionistas · masa S/27.7 M/mes.)

---

- [x] **Vista "Informe 📌"** (2026-08-25): resumen ejecutivo que cruza los tres
  datasets — proyectos, costo por ley (gasto del periodo ÷ leyes), ritmo de gasto
  diario, proyección de cierre 2026 (lineal + patrón histórico), conversión a ley
  por materia, y top-10 sueldos con nombre. Se recalcula solo con cada refresco.
- [x] **Mejora de gráficas** (2026-08-25): fuera el doble eje del chart de
  presupuesto (avance % ahora en su propio gráfico), doughnuts plegados a top-4 +
  "Otros", paleta categórica validada (CVD/contraste) por tema claro/oscuro,
  tooltips con formato S/ M.

- [x] **Congreso bicameral 2026–2031** (2026-10-26): vista "Bicameral 🏛️" con
  Senado y Diputados por separado. Hallazgo técnico: la API exige `codTipoParl`
  (S/D/C) para el nuevo periodo — sin él solo devolvía 6 proyectos "C" y el sitio
  seguía congelado en jul-2026. `web/build_bicameral.py` (CI diario).
- [x] **Ranking por bancada** — desbloqueado: el filtro real es
  `grupoParlamentarioId` (el `grupParId` que usábamos se ignora). Proyectos y
  proyectos por miembro por bancada, dato oficial.
- [x] **Padrón de congresistas** (130 diputados + 60 senadores) con bancada,
  partido, distrito y condición — WordPress de cada cámara (`wp-json/wp/v2/diputado|senador`).
- [x] **Asistencia y votaciones nominales del Pleno** — `pipeline/scrapers/plenos.py`
  lee los PDF de cada sesión (OCR con tesseract si son escaneos), valida cada
  bloque contra el total oficial al pie y cruza con el padrón. Corre en la laptop.
- [x] **Agenda de desarrollo**: eje por proyecto (inversión/empleo, infraestructura,
  capital humano, seguridad, inclusión, finanzas públicas, ambiente, gestión del
  Estado vs simbólico/re-presentado) + bandera de riesgo fiscal.
- [x] **Asesores por congresista** — 188/190 despachos identificados en la planilla
  (dependencia = nombre del congresista) con equipo, costo y de dónde venía cada uno.
- [x] **Movimientos de personal** — `web/build_movimientos.py`: altas/bajas/cambios
  entre meses usando los snapshots versionados de `personal.json`.

## 🔜 Próximo (alto valor de fiscalización)

- [ ] **Contratos / proveedores del Congreso** (OCDS/SEACE) — quién le vende al
  Congreso, montos, concentración por proveedor. Fuente: bulk mensual OCDS
  (`contratacionesabiertas.oece.gob.pe/api/v1/file/seace_v3/csv/AAAA/MM/`).
  Cruzar comprador = Congreso. Sección "Contratos" en el sitio.
- [ ] **Contrataciones polémicas en despachos** — con los equipos ya atribuidos,
  cruzar apellidos asesor↔congresista (posible nepotismo), sanciones RNSSC y
  rotación entre despachos.
- [ ] **Ranking por bancada 2021–2026** con `grupoParlamentarioId` (ahora que
  sabemos el nombre real del filtro) — hoy solo está para el periodo nuevo.
- [ ] **Viajes al extranjero y gastos operativos por congresista** — cada cámara
  tiene `wp-json/wp/v2/viaje` (hoy solo un índice vacío) y `actividad_diaria`
  (vacío). Revisar cuando publiquen.
- [ ] **Votaciones: afinidad entre bancadas** y votaciones divididas, ya con datos.
- [ ] **Senado**: casi todas sus actas son escaneos; vigilar calidad del OCR.
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
- [x] **Refresco local automático** (2026-09-01): `actualizar_todo.sh` (MEF +
  sync context.json + PTE, commit/push solo si hay datos nuevos) programado
  con launchd a diario 9:30 am — ver `infra/launchd/README.md`.
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
