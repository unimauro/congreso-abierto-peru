# Refresco automático local (launchd)

El MEF (Consulta Amigable) y el PTE bloquean las IPs de datacenter de GitHub
Actions, así que **presupuesto** y **personal** se refrescan desde la laptop.
Este LaunchAgent corre `actualizar_todo.sh` a diario a las **9:30 am** (hora
local); si la Mac estaba dormida, corre al despertar. Solo commitea y pushea
cuando hay datos nuevos.

> ⚠️ **Corre sobre un clon dedicado en `~/.auto/congreso-abierto-peru`**, no
> sobre la copia de trabajo: macOS (TCC) bloquea `~/Documents` para los
> procesos de launchd salvo que le des Full Disk Access a bash. El clon pushea
> a GitHub y la copia de trabajo se actualiza con el `git pull` de siempre.

## Instalar / actualizar

```bash
git clone https://github.com/unimauro/congreso-abierto-peru.git ~/.auto/congreso-abierto-peru  # solo la 1ª vez
cp infra/launchd/pe.congresoabierto.refresco.plist ~/Library/LaunchAgents/
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/pe.congresoabierto.refresco.plist
```

## Operación

```bash
# estado
launchctl print "gui/$(id -u)/pe.congresoabierto.refresco" | head -20

# forzar una corrida ahora
launchctl kickstart "gui/$(id -u)/pe.congresoabierto.refresco"

# ver el log
tail -50 ~/Library/Logs/congreso-refresco.log

# desinstalar
launchctl bootout "gui/$(id -u)/pe.congresoabierto.refresco"
rm ~/Library/LaunchAgents/pe.congresoabierto.refresco.plist
```

## Qué hace cada corrida

1. `git pull --rebase`
2. Scrapea presupuesto MEF 2016→hoy (Playwright + Chrome) y sincroniza la
   serie a `web/context.json` (`pipeline/sync_presupuesto_context.py`).
3. Scrapea la planilla PTE (`actualizar_personal.sh`, auto-detecta último mes).
4. Si `web/personal.json` solo cambió en el sello `generado`, lo descarta.
5. Commit + push únicamente si `context.json` o `personal.json` traen datos nuevos.

El legislativo (`web/data.json`) no pasa por aquí: lo regenera el cron diario
de GitHub Actions (`.github/workflows/pages.yml`).
