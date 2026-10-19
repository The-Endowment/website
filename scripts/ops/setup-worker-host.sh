#!/usr/bin/env bash
# Sets up an always-on Ubuntu host for one side of the collection workers:
#   --role reviewer   Roy's host: reviewer feed capture, reviewer pass, refresher
#   --role collector  Brett's host: collector feed capture, collector pass
# Run as root. Safe to re-run; re-running with a new --commit updates the code,
# pausing the worker timers while it does. It never overwrites existing keys,
# settings (worker.env, refresher.env, founders.json) or data, and never enables
# --submit: that stays a deliberate edit of /etc/endowment/worker.env. The
# systemd unit files are rewritten on every run; don't hand-edit them.
#
#   sudo bash setup-worker-host.sh --role reviewer --commit <sha> [--harden]
#
# --harden (fresh cloud servers only) turns on the firewall with inbound SSH
# only, plus automatic security updates. Leave it off on a box that runs other
# services, such as a validator, whose ports it would close.
set -euo pipefail

ROLE="" COMMIT="" HARDEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --role) ROLE="$2"; shift 2 ;;
    --commit) COMMIT="$2"; shift 2 ;;
    --harden) HARDEN=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[ "$ROLE" = reviewer ] || [ "$ROLE" = collector ] || { echo "Use --role reviewer or --role collector" >&2; exit 1; }
[ -n "$COMMIT" ] || { echo "Use --commit <reviewed commit sha>" >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)" >&2; exit 1; }

USER_NAME=endowment
APP=/opt/endowment/website
ETC=/etc/endowment
DATA=/var/lib/endowment
REPO=https://github.com/The-Endowment/website.git

echo "== Packages"
# List services that need restarting after package installs, never restart them.
export NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node --version)"

if [ "$HARDEN" = 1 ]; then
  echo "== Firewall (inbound SSH only) and automatic security updates"
  apt-get install -y -qq ufw unattended-upgrades >/dev/null
  # Allow the port sshd actually listens on, so a non-default SSH port isn't locked out.
  SSH_PORTS=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }')
  if [ -n "$SSH_PORTS" ]; then for p in $SSH_PORTS; do ufw allow "$p/tcp" >/dev/null; done
  else ufw allow OpenSSH >/dev/null; fi
  ufw --force enable >/dev/null
  dpkg-reconfigure -f noninteractive unattended-upgrades
fi

echo "== Service user and directories"
id "$USER_NAME" >/dev/null 2>&1 || useradd --system --home-dir /opt/endowment --create-home --shell /usr/sbin/nologin "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$ETC" "$ETC/keys" "$DATA" "$DATA/$ROLE"
[ "$ROLE" = reviewer ] && install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$DATA/refresher"

echo "== Pausing worker timers for the update"
# npm ci replaces node_modules, so no job may start or still be running meanwhile.
ACTIVE_TIMERS=$(systemctl list-units --type=timer --state=active --plain --no-legend 'endowment-*' | awk '{ print $1 }')
[ -z "$ACTIVE_TIMERS" ] || systemctl stop $ACTIVE_TIMERS
for s in endowment-feed endowment-collector endowment-reviewer endowment-refresher endowment-refresher-check; do
  while case "$(systemctl show -p ActiveState --value "$s.service" 2>/dev/null)" in activating|deactivating|reloading) true ;; *) false ;; esac; do
    echo "waiting for $s to finish"; sleep 5
  done
done
echo "paused: ${ACTIVE_TIMERS:-none}"

echo "== Code at $COMMIT"
if [ ! -d "$APP/.git" ]; then
  sudo -u "$USER_NAME" git clone -q "$REPO" "$APP"
fi
sudo -u "$USER_NAME" git -C "$APP" fetch -q origin
sudo -u "$USER_NAME" git -C "$APP" checkout -q --detach "$COMMIT"
(cd "$APP" && sudo -u "$USER_NAME" HOME=/opt/endowment npm ci --no-audit --no-fund --loglevel=error)

echo "== Keys"
new_key() {
  if [ -f "$ETC/keys/$1.json" ]; then echo "$1: keeping existing key"
  else (cd "$APP" && sudo -u "$USER_NAME" node scripts/ops/new-key.mjs "$ETC/keys/$1.json" >/dev/null); echo "$1: created"
  fi
}
if [ "$ROLE" = reviewer ]; then
  new_key reviewer
  new_key refresher
elif [ ! -f "$ETC/keys/collector.json" ]; then
  echo "collector: copy the existing collector key to $ETC/keys/collector.json (owner $USER_NAME, mode 600) before submitting"
fi

echo "== Settings"
write_once() { # write a settings file only if it does not exist yet
  if [ -f "$1" ]; then echo "$1: keeping existing file"; return; fi
  cat > "$1"; chown root:"$USER_NAME" "$1"; chmod 640 "$1"; echo "$1: created"
}
if [ "$ROLE" = reviewer ]; then PASS_ARGS="--role=reviewer" FOUNDERS=""
else PASS_ARGS="--role=collector --mode=founders" FOUNDERS="HOLD_FOUNDERS_FILE=$ETC/founders.json"
fi
UPPER=$(echo "$ROLE" | tr a-z A-Z)
write_once "$ETC/worker.env" <<EOF
# Shared by feed capture and the $ROLE pass. Edit, then: systemctl restart endowment-$ROLE.timer
NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID=HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6
NEXT_PUBLIC_ENDOWMENT_CREATOR=b5b42jEAoEj3WJnf2R29aPuKkkeUWmRLFsg1b8R3Fta
SOLANA_RPC_URL=
HOLD_DATA_DIR=$DATA/$ROLE
HOLD_KEYPAIR_FILE=$ETC/keys/$ROLE.json
HOLD_${UPPER}_FEED_HEARTBEAT_URL=
HOLD_${UPPER}_HEARTBEAT_URL=
# observe = read-only. For the funded test, change both lines together:
#   HOLD_HEARTBEAT_MODE=submit  and add --submit to PASS_ARGS.
HOLD_HEARTBEAT_MODE=observe
PASS_ARGS=$PASS_ARGS
$FOUNDERS
EOF
if [ "$ROLE" = collector ]; then
  write_once "$ETC/founders.json" <<'EOF'
[]
EOF
fi
if [ "$ROLE" = reviewer ]; then
  JITTER=$(openssl rand -hex 32)
  write_once "$ETC/refresher.env" <<EOF
# Refresher settings. Edit, then: systemctl restart endowment-refresher.timer
NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID=HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6
NEXT_PUBLIC_ENDOWMENT_CREATOR=b5b42jEAoEj3WJnf2R29aPuKkkeUWmRLFsg1b8R3Fta
SOLANA_RPC_URL=
REFRESHER_KEYPAIR_FILE=$ETC/keys/refresher.json
REFRESHER_DATA_DIR=$DATA/refresher
REFRESHER_JITTER_SECRET=$JITTER
REFRESHER_HEARTBEAT_URL=
EOF
fi

echo "== systemd units"
unit() { # name, env file, timeout, command, lock directory removed after the run (optional)
  # A timed-out run is killed before it can remove its lock; clear it once the run has stopped.
  # Only for locks no other unit uses (refresher.lock is shared with the manual check).
  local cleanup=""
  [ -z "${5:-}" ] || cleanup="ExecStopPost=-/bin/rm -rf $5"
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=Endowment $1
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER_NAME
WorkingDirectory=$APP
EnvironmentFile=$2
Environment=HOME=/opt/endowment
ExecStart=$4
$cleanup
TimeoutStartSec=$3
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DATA
# Yield to anything else on the host (e.g. a validator).
Nice=10
CPUWeight=20
IOWeight=20
MemoryMax=1G
EOF
}
timer() { # name, interval
  cat > "/etc/systemd/system/$1.timer" <<EOF
[Unit]
Description=Run $1 every $2

[Timer]
OnBootSec=30s
OnUnitActiveSec=$2
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
}
NODE=$(command -v node)
unit endowment-feed "$ETC/worker.env" 50s "$NODE scripts/capture-payout-feed.mts --role=$ROLE" "$DATA/$ROLE/feed.lock"
timer endowment-feed 30s
unit "endowment-$ROLE" "$ETC/worker.env" 4min "$NODE scripts/held-rewards.mts \$PASS_ARGS" "$DATA/$ROLE/worker.lock"
timer "endowment-$ROLE" 5min
if [ "$ROLE" = reviewer ]; then
  unit endowment-refresher "$ETC/refresher.env" 5min "$NODE scripts/refresher.mts --submit"
  timer endowment-refresher 15min
  # Read-only diagnostic, started by hand: systemctl start endowment-refresher-check
  unit endowment-refresher-check "$ETC/refresher.env" 5min "$NODE scripts/refresher.mts --check"
fi
systemctl daemon-reload
# Feed capture needs no key and should run from the start.
systemctl enable --now endowment-feed.timer >/dev/null
# Resume the timers that were running before the update. An empty founders list
# makes every collector pass fail and quarantine collection, so that one waits.
for t in $ACTIVE_TIMERS; do
  if [ "$t" = endowment-collector.timer ] && [ "$(tr -d '[:space:]' < "$ETC/founders.json")" = "[]" ]; then
    echo "NOT restarting $t: $ETC/founders.json is empty"; continue
  fi
  systemctl start "$t"; echo "resumed $t"
done

echo
echo "== Done. Addresses (public, safe to share):"
for k in "$ETC"/keys/*.json; do
  [ -f "$k" ] || continue
  printf '  %s: ' "$(basename "$k" .json)"
  (cd "$APP" && sudo -u "$USER_NAME" node --input-type=module -e "
    import { readFileSync } from 'node:fs'; import { getAddressDecoder } from '@solana/kit';
    const b = JSON.parse(readFileSync(process.argv[1], 'utf8'));
    console.log(getAddressDecoder().decode(Uint8Array.from(b.slice(32))));" "$k")
done
cat <<EOF

Next:
  1. Fill in SOLANA_RPC_URL and the heartbeat URLs:  sudo nano $ETC/worker.env
EOF
[ "$ROLE" = reviewer ] && echo "     and the refresher's:                            sudo nano $ETC/refresher.env"
[ "$ROLE" = collector ] && echo "     Put the founder wallet list in $ETC/founders.json (before step 3: an empty list stops collection)"
cat <<EOF
  2. Back up $ETC/keys offline (e.g. scp to your computer, then a USB stick).
  3. After collection setup on deploy day, start the pass:
       sudo systemctl enable --now endowment-$ROLE.timer
EOF
[ "$ROLE" = reviewer ] && cat <<EOF
     Check the refresher, then start it:
       sudo systemctl start endowment-refresher-check; journalctl -u endowment-refresher-check -n 30
       sudo systemctl enable --now endowment-refresher.timer
EOF
cat <<EOF
  Status: systemctl list-timers 'endowment-*'    Logs: journalctl -u endowment-feed -n 20
EOF
