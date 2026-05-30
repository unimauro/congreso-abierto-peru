# Fuentes de datos

Estado verificado al **2026-05-29**. Leyenda:
✅ confirmada (endpoint probado y responde) · 🟡 scrapeable (ruta clara, falta implementar) · ⚪ por investigar.

> Política anti-overclaiming: una fuente solo pasa a ✅ tras probar un request real
> que devuelve datos. Las pruebas de verificación están en los commits del pipeline.

## ✅ Confirmadas

### Proyectos de Ley (SPLEY)
- **Host:** `https://api.congreso.gob.pe/spley-portal-service`
  (el host público `wb2server.congreso.gob.pe` redirige 301 a `api.congreso.gob.pe`)
- **Listado:** `POST /proyecto-ley/lista-con-filtro?pageSize=&page=&rowStart=`
  - Body JSON: `{"perParId": 2021, "perLegId": null, "comisionId": null, "estadoId": null, "grupParId": null, "tipoFirmanteId": null, "congresistaId": null, "texto": null, "fechaPresentacion": null, "numeroProyecto": null}`
  - `perParId` es **obligatorio** (periodo parlamentario, ej. 2021, 2016, 2011…).
  - Respuesta: `data.proyectos[]` con campos:
    `perParId, pleyNum, proyectoLey, desEstado, fecPresentacion, titulo, desProponente, autores`.
- **PDF del proyecto:** `GET /archivo/{idBase64}/pdf` (id codificado en base64).
- Notas: la API parece ignorar `pageSize` y devuelve el listado completo del periodo
  (varios MB). El scraper lo maneja descargando todo el periodo de una vez.

## 🟡 Scrapeables (ruta identificada)

| Fuente | Ruta | Método |
|---|---|---|
| Comisiones (integrantes, sesiones) | `congreso.gob.pe/comisiones*` + datos abiertos por comisión | HTML / CSV |
| Presupuesto del Congreso | MEF Consulta Amigable `apps5.mineco.gob.pe` (pliego Congreso) | POST aspx |
| Personal / remuneraciones | PTE `transparencia.gob.pe` `id_entidad=16` | HTML / descargas |
| Contrataciones | OSCE / SEACE; Contraloría `portaltransparencia.contraloria.gob.pe` | HTML / API |
| Diario de Debates | actas en PDF | descarga + parsing PDF |
| Votaciones | actas de votación (PDF/HTML) | descarga + parsing |
| Asistencias / licencias | registros por sesión | HTML |

## ⚪ Por investigar

- Endpoint de **detalle de expediente** (tramitación por etapas): el path
  `/proyecto-ley/{id}` espera un id entero interno (no `pleyNum`); falta mapear el id.
- API estructurada de votaciones nominales (si existe servicio JSON).
- Combos del SPLEY (`/proyecto-ley/...`) para enumerar comisiones/estados/periodos.

## Periodos parlamentarios (`perParId`)

| perParId | Periodo |
|---|---|
| 2021 | 2021–2026 |
| 2016 | 2016–2021 |
| 2011 | 2011–2016 |
| 2006 | 2006–2011 |

Para "últimos 10 años" basta con `2021` y `2016` (más `2011` para margen).
