#!/usr/bin/env bash
# Indiano Trading Bot - pianificazione su Linux (es. Raspberry Pi 4B) con i timer di systemd dell'utente.
# Lancialo TU dalla cartella del progetto:
#     ./scripts/installa-pianificazione.sh            (installa)
#     ./scripts/installa-pianificazione.sh --rimuovi  (rimuove)
#
# Crea, per l'utente corrente:
#   indiano-tick.timer      -> il MOTORE: bun run tick ogni 5 minuti, lun-ven 09:00-23:00 ora di Roma,
#                              tempo massimo 20 minuti, mai due istanze insieme (un servizio oneshot non riparte finché è attivo)
#   indiano-scan.timer      -> bun run scan il sabato alle 10:00 ora di Roma (poi controlla la review), tempo massimo 3 ore
#   indiano-dashboard       -> la DASHBOARD: bun run dashboard sempre attiva, riavviata se si chiude
# Gli orari sono in ora di Roma qualunque sia il fuso del sistema (OnCalendar con fuso esplicito, systemd >= 235).
set -euo pipefail

PROGETTO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNITA=(indiano-tick.service indiano-tick.timer indiano-scan.service indiano-scan.timer indiano-dashboard.service)

if [[ "${1:-}" == "--rimuovi" ]]; then
  systemctl --user disable --now indiano-tick.timer indiano-scan.timer indiano-dashboard.service 2>/dev/null || true
  for u in "${UNITA[@]}"; do rm -f "$DIR/$u"; done
  systemctl --user daemon-reload
  echo "Attività rimosse."
  exit 0
fi

BUN="$(command -v bun || true)"
[[ -z "$BUN" && -x "$HOME/.bun/bin/bun" ]] && BUN="$HOME/.bun/bin/bun"
if [[ -z "$BUN" ]]; then
  echo "bun non trovato. Installalo con:  curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
command -v systemctl >/dev/null || { echo "systemd non disponibile su questo sistema." >&2; exit 1; }
[[ -f "$PROGETTO/secrets.ts" ]] || echo "Attenzione: secrets.ts non trovato. Il bot non lavorerà finché non lo compili." >&2

PATH_UNITA="$HOME/.local/bin:$(dirname "$BUN"):/usr/local/bin:/usr/bin:/bin"
mkdir -p "$DIR"

cat > "$DIR/indiano-tick.service" <<EOF
[Unit]
Description=Indiano Trading: sveglia del motore (bun run tick)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$PROGETTO
Environment=PATH=$PATH_UNITA
ExecStart=$BUN run tick
TimeoutStartSec=20min
EOF

cat > "$DIR/indiano-tick.timer" <<EOF
[Unit]
Description=Indiano Trading: tick ogni 5 minuti, lun-ven 09:00-23:00 ora di Roma

[Timer]
OnCalendar=Mon..Fri *-*-* 09..22:00/5:00 Europe/Rome
OnCalendar=Mon..Fri *-*-* 23:00:00 Europe/Rome
AccuracySec=10s
Persistent=false

[Install]
WantedBy=timers.target
EOF

cat > "$DIR/indiano-scan.service" <<EOF
[Unit]
Description=Indiano Trading: scansione del sabato e review
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$PROGETTO
Environment=PATH=$PATH_UNITA
ExecStart=$BUN run scan
TimeoutStartSec=3h
EOF

cat > "$DIR/indiano-scan.timer" <<EOF
[Unit]
Description=Indiano Trading: scansione il sabato alle 10:00 ora di Roma

[Timer]
OnCalendar=Sat *-*-* 10:00:00 Europe/Rome
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > "$DIR/indiano-dashboard.service" <<EOF
[Unit]
Description=Indiano Trading: dashboard su 127.0.0.1 e lettura dei pulsanti Telegram
After=network-online.target

[Service]
WorkingDirectory=$PROGETTO
Environment=PATH=$PATH_UNITA
ExecStart=$BUN run dashboard
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now indiano-tick.timer indiano-scan.timer indiano-dashboard.service

# senza "linger" i servizi dell'utente si fermano quando l'utente esce (su un Raspberry senza schermo serve)
if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q "yes"; then
  if loginctl enable-linger "$USER" 2>/dev/null; then
    echo "Linger abilitato: le attività girano anche senza accesso."
  else
    echo "Per far girare le attività anche senza accesso, lancia una volta:  sudo loginctl enable-linger $USER"
  fi
fi

echo
echo "Fatto. Controlla con:  systemctl --user list-timers 'indiano-*'"
echo "Log di una sveglia:   journalctl --user -u indiano-tick.service -n 50   (e la cartella logs/ del progetto)"
echo "Dashboard:            http://127.0.0.1:8787  (solo da questo computer; da un altro PC usa un tunnel SSH: ssh -L 8787:127.0.0.1:8787 utente@raspberry)"
