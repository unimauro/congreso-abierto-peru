#!/usr/bin/env bash
# Refresca la planilla del Congreso desde el PTE y regenera web/personal.json.
#
# ⚠️ Correr DESDE LA LAPTOP (IP residencial peruana): el Portal de Transparencia
# bloquea las IPs de datacenter de GitHub Actions. Por eso NO va en CI.
#
# Uso:  ./actualizar_personal.sh            # detecta el último mes con datos
#       ./actualizar_personal.sh 2026 7      # año y mes explícitos
set -euo pipefail
cd "$(dirname "$0")"

HOY="$(date -u +%Y-%m-%d)"

if [ "$#" -ge 2 ]; then
  echo "[*] Scrapeando planilla PTE del Congreso — $1-$2..."
  python3 -m pipeline.scrapers.personal_pte --anio "$1" --mes "$2" --out data
else
  echo "[*] Scrapeando planilla PTE del Congreso (auto-detección de último mes)..."
  python3 -m pipeline.scrapers.personal_pte --auto --desde-anio "$(date -u +%Y)" --desde-mes "$(date -u +%-m)" --out data
fi

echo "[*] Regenerando web/personal.json..."
python3 web/build_personal.py --fecha "$HOY"

echo "[ok] Listo. Revisa web/personal.json y luego:"
echo "     git add data/personal_congreso.csv web/personal.json && git commit -m 'Personal: refresco planilla PTE' && git push"
