#!/usr/bin/env bash
# Indiano Trading Bot - avvio su Linux (es. Raspberry Pi 4B, sistema a 64 bit) e macOS.
#   ./start.sh                 aiuto e controlli
#   ./start.sh installa        registra motore, scansione e dashboard nei timer di systemd
#   ./start.sh avvia           motore e dashboard insieme (Ctrl+C li ferma entrambi)
#   ./start.sh motore          motore in primo piano (un tick ogni 30 s), senza pianificazione
#   ./start.sh dashboard       webapp su http://127.0.0.1:8787
#   ./start.sh <comando> ...   tick, once, scan, review, status, probe, test (le opzioni passano a bun, es. --fake)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

BUN="$(command -v bun || true)"
[[ -z "$BUN" && -x "$HOME/.bun/bin/bun" ]] && BUN="$HOME/.bun/bin/bun"
if [[ -z "$BUN" ]]; then
  echo "Manca bun. Installalo con:  curl -fsSL https://bun.sh/install | bash   (poi riapri il terminale)" >&2
  exit 1
fi
export PATH="$HOME/.local/bin:$(dirname "$BUN"):$PATH"

cmd="${1:-aiuto}"
[[ $# -gt 0 ]] && shift

vuole_finto=0
for a in "$@"; do [[ "$a" == "--fake" ]] && vuole_finto=1; done
# Primo avvio: niente da compilare a mano. "avvia" (o "dashboard") apre la configurazione guidata nel browser.
case "$cmd" in
  tick|once|scan|review|status|probe)
    if [[ ! -f secrets.ts && $vuole_finto -eq 0 ]]; then
      echo "Il bot non è ancora configurato. Lancia  ./start.sh avvia  e apri il link della configurazione guidata che compare nel terminale." >&2
      echo "Per provare senza chiavi aggiungi --fake (broker, dati e cervello finti)." >&2
      exit 1
    fi ;;
esac
# 75 = il processo chiede di essere riavviato (configurazione appena salvata)
RIAVVIO=75
riavviabile() {
  local codice
  while true; do
    set +e
    "$BUN" run "$@"
    codice=$?
    set -e
    [[ $codice -eq $RIAVVIO ]] || return $codice
  done
}

case "$cmd" in
  aiuto|help|-h|--help)
    echo "Indiano Trading Bot - bun $("$BUN" --version)"
    command -v claude >/dev/null && echo "claude: $(claude --version 2>/dev/null)" || echo "claude: NON trovato (serve al cervello: https://claude.ai/install.sh)"
    [[ -f secrets.ts ]] && echo "secrets.ts: presente" || echo "secrets.ts: assente (al primo ./start.sh avvia la dashboard ti guida nella configurazione)"
    sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  installa) exec ./scripts/installa-pianificazione.sh ;;
  disinstalla) exec ./scripts/installa-pianificazione.sh --rimuovi ;;
  avvia) exec "$BUN" run avvia "$@" ;;
  motore) riavviabile schedule "$@" ;;
  dashboard) riavviabile dashboard "$@" ;;
  test) exec "$BUN" test "$@" ;;
  tick|once|scan|review|status|probe|schedule|build) exec "$BUN" run "$cmd" "$@" ;;
  *) echo "Comando sconosciuto: $cmd (./start.sh aiuto)" >&2; exit 1 ;;
esac
