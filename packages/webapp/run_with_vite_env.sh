#!/bin/bash

# The path to your .env file
ENV_FILE="./../../.env"

# The command you want to run after setting the environment variables
COMMAND="$@"

# Check if the .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Warning: $ENV_FILE does not exist. Continuing without loading environment variables from $ENV_FILE"
else
    echo "Loading env vars from $ENV_FILE"
    # Export each line as an environment variable, prepending with VITE_
    while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip lines that are empty or start with a hash (#)
    if [[ ! $line || $line == \#* ]]; then
        continue
    fi
    # Prepend VITE_ and export as an environment variable
    IFS='=' read -ra ADDR <<< "$line"
    export VITE_${ADDR[0]}="${ADDR[1]}"
done < "$ENV_FILE"
fi

# Execute the command
eval $COMMAND
