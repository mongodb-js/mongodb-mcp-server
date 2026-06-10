#!/usr/bin/env sh
set -e

CONTAINER_NAME=mcp-eval-db
IMAGE=mongodb/mongodb-atlas-local:latest

function start() {
    docker run -d --rm --name="$CONTAINER_NAME" --publish=27017:27017 "$IMAGE"
    docker logs -f "$CONTAINER_NAME" &
    LOG_PID=$!
    until [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_NAME")" = "healthy" ]; do
        sleep 1
    done
    kill "$LOG_PID" 2>/dev/null || true
    wait "$LOG_PID" 2>/dev/null || true
    
	echo "✅ MongoDB container ($CONTAINER_NAME) is healthy and accepting connections at localhost:27017."
	echo ""
	echo "To use this local MongoDB instance for Braintrust evals in a remote/sandboxed environment:"
	echo "  1. In a new terminal, run: `ngrok tcp 27017`"
	echo "  2. After it starts, note the 'Forwarding' address (e.g. `tcp://0.tcp.us-cal-1.ngrok.io:21413`)."
	echo "  3. Convert that to a MongoDB URI like:"
	echo "       `mongodb://0.tcp.us-cal-1.ngrok.io:21413/?directConnection=true`"
	echo "  4. Paste this connection string into the 'connectionString' field in your eval script."
}

function stop() {
    docker rm --force "$CONTAINER_NAME"
    echo "MongoDB stopped ($CONTAINER_NAME)"
}

case "$1" in
    start) start ;;
    stop) stop ;;
    *) echo "Usage: $0 {start|stop}" ;;
esac