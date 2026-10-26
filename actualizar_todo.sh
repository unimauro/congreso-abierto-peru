#!/usr/bin/env bash
# Refresco local completo: presupuesto (MEF) + personal (PTE) + movimientos +
# Pleno (actas PDF con OCR) + commit/push.
#
# ⚠️ Correr DESDE LA LAPTOP (IP residencial): el MEF y el PTE bloquean las IPs
# de datacenter de GitHub Actions, por eso estos dos datasets NO van en CI.
# El legislativo (data.json) sí se refresca solo con el cron diario de pages.yml.
#
# Pensado para correr a mano o desde launchd (ver infra/launchd/README.md).
# Solo commitea si hay datos nuevos; un cambio que sea únicamente el sello
# "generado" de personal.json se descarta para no ensuciar el historial.
set -euo pipefail
cd "$(dirname "$0")"

# launchd arranca con un PATH mínimo: agregar pyenv, homebrew y git-credential-manager.
export PATH="$HOME/.pyenv/shims:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Si el clon tiene su venv (con playwright), usarlo: el pyenv que resuelve
# launchd puede no ser el mismo que el del shell interactivo.
if [ -x ".venv/bin/python3" ]; then
  export PATH="$PWD/.venv/bin:$PATH"
fi

echo "=== Refresco total $(date '+%Y-%m-%d %H:%M') ==="

echo "[*] git pull..."
git pull --rebase

echo "[*] Presupuesto MEF (2016-$(date +%Y), Playwright)..."
python3 -m pipeline.scrapers.presupuesto_mef --desde 2016 --hasta "$(date +%Y)" --out data/
python3 pipeline/sync_presupuesto_context.py

echo "[*] Personal PTE..."
./actualizar_personal.sh

echo "[*] Movimientos de personal (snapshots en git)..."
python3 web/build_movimientos.py --fecha "$(date +%Y-%m-%d)"

# Pleno: agenda, asistencia y votaciones desde los PDF de cada cámara (OCR con
# tesseract cuando son escaneos; el texto queda cacheado en data/plenos/).
echo "[*] Pleno (asistencia y votaciones)..."
python3 -m pipeline.scrapers.plenos || echo "[!] plenos falló; se mantiene el plenos.json anterior"

# Si personal.json solo cambió en la línea "generado" (el PTE no publicó mes
# nuevo), descartar para no generar un commit diario sin datos.
if git diff --quiet -I'"generado"' -- web/personal.json; then
  git checkout -- web/personal.json
fi

# Igual con los "generado" de movimientos/plenos: solo cuentan cambios de datos.
for f in web/movimientos.json web/plenos.json; do
  if git diff --quiet -I'"generado"' -- "$f" 2>/dev/null; then git checkout -- "$f" 2>/dev/null || true; fi
done

if git diff --quiet -- web/context.json web/personal.json web/movimientos.json web/plenos.json \
   && [ -z "$(git ls-files --others --exclude-standard web/movimientos.json web/plenos.json)" ]; then
  echo "[ok] Sin datos nuevos: nada que commitear."
  exit 0
fi

echo "[*] Commiteando datos nuevos..."
git add web/context.json web/personal.json web/movimientos.json web/plenos.json
git commit -m "chore(datos): refresco local presupuesto/personal $(date '+%Y-%m-%d')"
git push
echo "[ok] Pusheado."
