#!/bin/bash

# Get the directory of the current script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Define the path for the shell history file in the script directory
HISTORY_FILE="$SCRIPT_DIR/bash_history"

# Check if the history file exists, if not, create an empty one
if [ ! -f "$HISTORY_FILE" ]; then
    touch "$HISTORY_FILE"
fi

# Check if node:latest image is available
if [[ "$(docker images -q node:latest 2> /dev/null)" == "" ]]; then
  echo "node:latest image not found. Pulling from Docker Hub..."
  docker pull node:latest
fi

# Run the Docker command with relative paths and mount the history file
docker run -it \
  -e OPENAI_API_KEY \
  -e SUPABASE_SERVICE_ROLE_KEY_HEADLONG \
  -e SUPABASE_URL_HEADLONG \
  -e SERPAPI_API_KEY \
  -e TWILIO_ACCOUNT_SID \
  -e TWILIO_AUTH_TOKEN \
  -e TWILIO_PHONE_NUMBER \
  -v "$SCRIPT_DIR"/../..:/app/headlong \
  -v "$HISTORY_FILE":/root/.bash_history \
  -w /app/headlong/packages/env \
  --name headlong-env \
node /bin/bash
# you need to install ht binary first (UPDATE THE `ht` VERSION IN URL BELOW TO THE NEWEST VERSION)
# wget https://github.com/andyk/ht/releases/download/v0.1.1/ht-aarch64-unknown-linux-gnu.ht-aarch64-unknown-linux-gnu
# mv ht-aarch64-unknown-linux-gnu.ht-aarch64-unknown-linux-gnu /usr/local/bin/ht
# chmod +x /usr/local/bin/ht
#
# you may also want to install nano via the following:
# apt-get update
# apt-get install nano
#
# node npm install
# node npm run env

