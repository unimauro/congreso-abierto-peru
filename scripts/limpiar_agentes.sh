#!/usr/bin/env bash
# Limpia restos de agentes de Claude Code en este repo:
#  - copias de trabajo (.claude/worktrees/agent-*) cuyo trabajo YA está en master y sin cambios sin guardar
#  - servidores de prueba (python -m http.server) lanzados desde este repo o sus worktrees
# Nunca borra trabajo sin integrar: si una copia tiene commits que no están en master, la deja y avisa.
# Las ramas worktree-agent-* integradas también se borran (su contenido ya vive en master).
#
#   scripts/limpiar_agentes.sh          # limpia
#   scripts/limpiar_agentes.sh --dry    # solo muestra qué haría
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
DRY=${1:-}
run() { if [ "$DRY" = "--dry" ]; then echo "  (dry) $*"; else "$@"; fi; }
REPO=$PWD

for w in .claude/worktrees/agent-*; do
  [ -d "$w" ] || continue
  rama=$(git -C "$w" branch --show-current 2>/dev/null)
  sucio=$(git -C "$w" status --porcelain 2>/dev/null | grep -v '^??' | head -1)
  pend=$(git cherry master "$rama" 2>/dev/null | grep -c '^+')
  # un "+" puede ser un parche ya integrado a mano (conflicto resuelto): se compara el contenido final
  if [ "$pend" -gt 0 ] && git diff --quiet master "$rama" -- $(git diff --name-only "$(git merge-base master "$rama")" "$rama") 2>/dev/null; then pend=0; fi
  if [ -n "$sucio" ] || [ "$pend" -gt 0 ]; then
    echo "· se conserva $w ($rama): $pend commits sin integrar${sucio:+, cambios sin guardar}"
    continue
  fi
  echo "· borro $w ($rama): ya integrado"
  run git worktree remove -f -f "$w"
  run git branch -D "$rama" >/dev/null
done
run git worktree prune

for pid in $(pgrep -f "http.server" 2>/dev/null); do
  cwd=$(lsof -a -d cwd -p "$pid" 2>/dev/null | awk 'NR==2{print $NF}')
  case "$cwd" in "$REPO"*) echo "· detengo servidor de prueba pid $pid ($cwd)"; run kill "$pid" ;; esac
done
echo "listo."
