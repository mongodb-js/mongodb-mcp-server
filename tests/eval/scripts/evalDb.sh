#!/usr/bin/env sh
set -e

CONTAINER_NAME=mcp-eval-db
IMAGE=mongodb/mongodb-atlas-local:latest

start() {
    docker run -d --rm --name="$CONTAINER_NAME" --publish=27017:27017 "$IMAGE"
    docker logs -f "$CONTAINER_NAME" &
    LOG_PID=$!
    until [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_NAME")" = "healthy" ]; do
        sleep 1
    done
    kill "$LOG_PID" 2>/dev/null || true
    wait "$LOG_PID" 2>/dev/null || true
    
	cat <<EOF
✅ MongoDB container ($CONTAINER_NAME) is healthy and accepting connections at localhost:27017.
✅ To use this local MongoDB instance in Braintrust local or remote evals you are good to go.

If you intend to use this local MongoDB instance in Braintrust sandboxed environment:
  1. In a new terminal, run: \`ngrok tcp 27017\`
  2. After it starts, note the 'Forwarding' address (e.g. \`tcp://0.tcp.us-cal-1.ngrok.io:21413\`).
  3. Convert that to a MongoDB URI like:
       \`mongodb://0.tcp.us-cal-1.ngrok.io:21413/?directConnection=true\`
  4. Paste this connection string into the 'connectionString' field in your eval script.
EOF
}

stop() {
    docker rm --force "$CONTAINER_NAME"
    echo "MongoDB stopped ($CONTAINER_NAME)"
}

case "$1" in
    start) start ;;
    stop) stop ;;
    *) echo "Usage: $0 {start|stop}" ;;
esac