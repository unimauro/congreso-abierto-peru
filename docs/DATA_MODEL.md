# Modelo de datos

Modelo objetivo. PostgreSQL es el almacén transaccional (OLTP); ClickHouse guarda
agregados históricos para análisis (OLAP). Las entidades en **negrita** son las de
Fase 1 (ya scrapeables).

## Entidades núcleo

### **proyectos_ley** (Fase 1 ✅)
| Campo | Tipo | Notas |
|---|---|---|
| id | bigserial PK | |
| periodo | int | perParId (2021, 2016…) |
| numero | int | pleyNum |
| codigo | text | ej. `14704/2025-CR` |
| estado | text | PRESENTADO, EN COMISIÓN, APROBADO… |
| fecha_presentacion | date | |
| titulo | text | |
| proponente | text | Congreso, Poder Ejecutivo… |
| created_at / updated_at | timestamptz | para detección de cambios |

### **proyecto_autores** (Fase 1 ✅)
Relación N:M proyecto ↔ congresista (parseada del campo `autores`).
| proyecto_id | FK | |
| congresista_id | FK (nullable hasta resolver identidad) | |
| nombre_raw | text | nombre tal como viene en la fuente |
| rol | text | autor principal / coautor |

### congresistas (Fase 2–3)
foto, partido/bancada, región, periodo, comisiones, asistencia, licencias,
proyectos (presentados/aprobados/archivados), intervenciones, historial de votos.
+ indicadores derivados: productividad, participación, transparencia, influencia.

### bancadas / partidos (Fase 3)
nº congresistas, proyectos, asistencia promedio, disciplina partidaria, coincidencia de votos.

### **comisiones** (Fase 1 🟡)
integrantes, presupuesto, personal, sesiones, asistencia, proyectos revisados/dictaminados.

### votaciones / votos (Fase 2)
votación (fecha, asunto, resultado) ↔ voto por congresista (SÍ/NO/ABST/AUSENTE).

### asistencias (Fase 2)
sesión ↔ congresista ↔ estado (presente/ausente/licencia).

### **presupuesto** (Fase 1 🟡)
ejecución por año/partida, viajes, contrataciones, consultorías, bienes y servicios.

### personal (Fase 2)
clasificación (asesores/técnicos/administrativos/seguridad/funcionarios), costo
mensual/anual, distribución por área, series históricas.

## Capa analítica (ClickHouse, Fase 3)

Tablas desnormalizadas y materialized views para:
- series temporales de presupuesto y personal (10 años),
- rankings de productividad por congresista/bancada,
- matrices de coincidencia de votos,
- indicadores estrella: costo por ley aprobada, costo por congresista, etc.

## Vector store (pgvector, Fase 5)

Embeddings de títulos/textos de proyectos y actas para RAG con citas a la fuente.
