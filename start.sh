#!/bin/bash
echo "🚀 Initializing Antigravity Render Node..."

# 1. Install cloudflared if missing
if [ ! -f ./cloudflared ]; then
    echo "⬇️ Downloading cloudflared..."
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
    chmod +x cloudflared
fi

# 2. Start Tunnel Receiver (Background)
# Hostname provided by user: may-showcase-buyers-dark.trycloudflare.com
TUNNEL_URL="may-showcase-buyers-dark.trycloudflare.com"
LOCAL_PORT="127.0.0.1:9090"

echo "🔗 Establishing tunnel to $TUNNEL_URL -> $LOCAL_PORT"
./cloudflared access tcp --hostname $TUNNEL_URL --url $LOCAL_PORT &

# 3. Wait for tunnel to stabilize
echo "⏳ Waiting 5s for tunnel to bind..."
sleep 5

# 4. Start Node.js Application
echo "🟢 Starting Antigravity Server..."
node server.js
