FROM python:3.11-slim

# Install tmux (required by libtmux terminal tool) and Node.js (required by Claude Code)
RUN apt-get update && apt-get install -y --no-install-recommends tmux curl && rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS) for Claude Code CLI
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app/headlong/packages/env

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Chromium browser and its OS dependencies
RUN playwright install --with-deps chromium

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash headlong
USER headlong

# Default command: run the env daemon (agent name passed as CMD arg)
ENTRYPOINT ["python", "main.py"]
