#!/bin/bash
set -e

# Get the directory of the current script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
REPO_ROOT="$SCRIPT_DIR/../.."

IMAGE_NAME="headlong-env"
CONTAINER_NAME="headlong-env"
AGENT_NAME="${1:-}"

if [ -z "$AGENT_NAME" ]; then
  echo "Usage: ./run_in_docker.sh <agent_name>"
  echo "Example: ./run_in_docker.sh andy"
  exit 1
fi

# Load .env from repo root so env vars are available for docker run
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

# Remove any stopped container with the same name
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# Build the image from the Dockerfile
echo "Building $IMAGE_NAME image..."
docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

# Run the container
echo "Starting env daemon for agent: $AGENT_NAME"
docker run -it \
  --name "$CONTAINER_NAME" \
  -e ANTHROPIC_API_KEY \
  -e SUPABASE_URL_HEADLONG \
  -e SUPABASE_SERVICE_ROLE_KEY_HEADLONG \
  -e TELEGRAM_BOT_TOKEN \
  -e TELEGRAM_CHAT_ID \
  -e SERPAPI_API_KEY \
  -e OPENAI_API_KEY \
  -e OPENROUTER_API_KEY \
  -p 8000:8000 \
  -v "$REPO_ROOT":/app/headlong \
  -w /app/headlong/packages/env \
  "$IMAGE_NAME" \
  "$AGENT_NAME"
