#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# scripts/run_migrations.sh — Run all Headlong Supabase migrations in order
#
# Usage:
#   ./scripts/run_migrations.sh                   # uses SUPABASE_DB_URL from .env
#   ./scripts/run_migrations.sh postgresql://...  # pass URL explicitly
#
# Before running, set your agent_repl password:
#   export AGENT_REPL_PASSWORD=your-strong-password
#
# Notes:
#   - Use the SESSION pooler URL (port 5432), not transaction mode (port 6543)
#   - The direct db.<ref>.supabase.co host is disabled on newer Supabase projects;
#     the pooler URL is the correct choice
#   - Migration 003 creates the agent_repl Postgres role. The script injects
#     AGENT_REPL_PASSWORD at runtime so the file itself stays safe to commit.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"

# ---------------------------------------------------------------------------
# Load .env from repo root if present
# ---------------------------------------------------------------------------
if [[ -f "$SCRIPT_DIR/../.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../.env"
  set +a
fi

# ---------------------------------------------------------------------------
# Resolve DB URL — use session pooler (port 5432)
# ---------------------------------------------------------------------------
DB_URL="${1:-${SUPABASE_DB_URL:-}}"

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: No database URL found."
  echo "  Set SUPABASE_DB_URL in .env, or pass the URL as an argument."
  echo "  Use the session pooler URL (port 5432):"
  echo "  postgresql://postgres.<ref>:[password]@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
  exit 1
fi

# ---------------------------------------------------------------------------
# Check agent_repl password for migration 003
# ---------------------------------------------------------------------------
AGENT_REPL_PASSWORD="${AGENT_REPL_PASSWORD:-}"

if [[ -z "$AGENT_REPL_PASSWORD" ]]; then
  echo ""
  echo "Migration 003 creates an 'agent_repl' Postgres role and needs a password."
  read -r -s -p "Enter password for agent_repl role: " AGENT_REPL_PASSWORD
  echo ""
  if [[ -z "$AGENT_REPL_PASSWORD" ]]; then
    echo "ERROR: agent_repl password cannot be empty."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Check psql is available
# ---------------------------------------------------------------------------
if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Install it with:"
  echo "  brew install libpq"
  echo "  export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\""
  exit 1
fi

# ---------------------------------------------------------------------------
# Run migrations
# ---------------------------------------------------------------------------
MIGRATIONS=("$MIGRATIONS_DIR"/0*.sql)

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  echo "ERROR: No migration files found in $MIGRATIONS_DIR"
  exit 1
fi

echo ""
echo "Running ${#MIGRATIONS[@]} migrations against:"
echo "  ${DB_URL//:*@/@[password]@}"  # redact password in output
echo ""

PASS=0
FAIL=0

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration")"
  echo -n "  [$name] ... "

  # For migration 003: substitute the agent_repl password
  if [[ "$name" == "003_"* ]]; then
    sql="$(sed "s/CHANGE_ME_BEFORE_RUNNING/$AGENT_REPL_PASSWORD/g" "$migration")"
    if psql "$DB_URL" --set ON_ERROR_STOP=1 -q -c "$sql" 2>&1; then
      echo "OK"
      ((PASS++))
    else
      echo "FAILED"
      ((FAIL++))
      echo ""
      echo "Aborting — fix the error above and re-run."
      exit 1
    fi
  else
    if psql "$DB_URL" --set ON_ERROR_STOP=1 -q -f "$migration" 2>&1; then
      echo "OK"
      ((PASS++))
    else
      echo "FAILED"
      ((FAIL++))
      echo ""
      echo "Aborting — fix the error above and re-run."
      exit 1
    fi
  fi
done

echo ""
echo "Done — $PASS migrations applied successfully."
echo ""
echo "Next: add AGENT_REPL_DB_URL to your .env using the same host as SUPABASE_DB_URL"
echo "  but with agent_repl as the username and the password you just set:"
echo "  postgresql://agent_repl.<your-project-ref>:<agent_repl_password>@<your-pooler-host>:5432/postgres"
