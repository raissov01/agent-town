#!/usr/bin/env bash
# Agent Town relay + cloud worker → өз серверің (Docker + systemd бар Linux).
# Build жоқ: node:22-alpine контейнері кодты томнан оқиды.
#
#   TOWN_SERVER=root@1.2.3.4 ./deploy.sh
#
# Мәндерді .deploy.env файлына да жазуға болады (git-ке кірмейді).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .deploy.env ] && . ./.deploy.env
HOST=${TOWN_SERVER:?TOWN_SERVER орнат, мысалы root@1.2.3.4}
DIR=${TOWN_DIR:-/opt/agent-town}
PORT=${TOWN_PORT:-3020}

ssh "$HOST" "mkdir -p $DIR/relay/public $DIR/data $DIR/worker"
tar -C relay -cf - relay.js public | ssh "$HOST" "tar -C $DIR/relay -xf -"
tar -cf - -C worker cloud_worker.py -C ../bridge cloud_launch.py | ssh "$HOST" "tar -C $DIR/worker -xf -"
# relay/.env.prod (TOWN_PASSWORD, BRIDGE_TOKEN, SESSION_SECRET) — бір рет көшіріледі
if [ -f relay/.env.prod ] && ! ssh "$HOST" "test -f $DIR/.env"; then
  ssh "$HOST" "umask 077; cat > $DIR/.env" < relay/.env.prod
fi

ssh "$HOST" DIR="$DIR" PORT="$PORT" bash -s <<'REMOTE'
set -e
cd "$DIR"
docker rm -f agent-town >/dev/null 2>&1 || true
docker run -d --name agent-town --restart unless-stopped \
  --env-file .env -e DATA_DIR=/data -e PORT="$PORT" -e HOST=0.0.0.0 \
  -v "$DIR/relay:/app:ro" -v "$DIR/data:/data" \
  -p "127.0.0.1:$PORT:$PORT" --memory 128m -w /app node:22-alpine node relay.js >/dev/null
sleep 2; docker logs --tail 3 agent-town
curl -s -o /dev/null -w "relay %{http_code}\n" "http://127.0.0.1:$PORT/"

# бұлт worker-і (ноутбук офлайн кезде claude --cloud). claude CLI жоқ болса — өткізіп жібереміз
CLAUDE_BIN=$(command -v claude || echo /root/.local/bin/claude)
if [ -x "$CLAUDE_BIN" ]; then
cat > /etc/systemd/system/agent-town-cloud.service <<UNIT
[Unit]
Description=Agent Town cloud worker
After=network-online.target docker.service

[Service]
EnvironmentFile=$DIR/.env
Environment=RELAY_URL=http://127.0.0.1:$PORT DATA_DIR=$DIR/data REPOS_DIR=$DIR/repos CLAUDE_BIN=$CLAUDE_BIN HOME=/root PATH=$(dirname "$CLAUDE_BIN"):/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/python3 $DIR/worker/cloud_worker.py
Restart=always
RestartSec=5
MemoryMax=700M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable agent-town-cloud >/dev/null 2>&1
systemctl restart agent-town-cloud
echo "cloud worker: $(systemctl is-active agent-town-cloud)"
else
echo "cloud worker: claude CLI табылмады — өткізілді (curl -fsSL https://claude.ai/install.sh | bash)"
fi
REMOTE
