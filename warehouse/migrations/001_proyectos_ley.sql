-- Fase 1 — Esquema base: proyectos de ley y autores.
-- Idempotente: upsert por clave natural (periodo, numero).

CREATE TABLE IF NOT EXISTS proyectos_ley (
    id                 BIGSERIAL PRIMARY KEY,
    periodo            INTEGER     NOT NULL,           -- perParId
    numero             INTEGER     NOT NULL,           -- pleyNum
    codigo             TEXT        NOT NULL,           -- "14704/2025-CR"
    estado             TEXT,
    fecha_presentacion DATE,
    titulo             TEXT,
    proponente         TEXT,
    fuente             TEXT        NOT NULL DEFAULT 'spley-portal-service',
    fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (periodo, numero)
);

CREATE INDEX IF NOT EXISTS idx_proyectos_estado  ON proyectos_ley (estado);
CREATE INDEX IF NOT EXISTS idx_proyectos_fecha   ON proyectos_ley (fecha_presentacion);
CREATE INDEX IF NOT EXISTS idx_proyectos_periodo ON proyectos_ley (periodo);

CREATE TABLE IF NOT EXISTS proyecto_autores (
    id            BIGSERIAL PRIMARY KEY,
    proyecto_id   BIGINT NOT NULL REFERENCES proyectos_ley (id) ON DELETE CASCADE,
    nombre_raw    TEXT   NOT NULL,                     -- nombre tal cual viene en la fuente
    congresista_id BIGINT,                             -- se resuelve en Fase 3
    orden         INTEGER,                             -- 0 = autor principal
    UNIQUE (proyecto_id, nombre_raw)
);

CREATE INDEX IF NOT EXISTS idx_autores_nombre ON proyecto_autores (nombre_raw);
