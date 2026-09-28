#!/usr/bin/env bash
# Shared helpers. Sourced by every script in this directory.

set -Eeuo pipefail

# Colours, but only when stdout is a terminal — otherwise CI logs fill with
# escape codes.
if [[ -t 1 ]]; then
  R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[34m'; DIM=$'\e[2m'; N=$'\e[0m'
else
  R=''; G=''; Y=''; B=''; DIM=''; N=''
fi

step()  { printf '\n%s==>%s %s\n' "$B" "$N" "$*"; }
info()  { printf '    %s\n' "$*"; }
ok()    { printf '    %s✓%s %s\n' "$G" "$N" "$*"; }
warn()  { printf '    %s!%s %s\n' "$Y" "$N" "$*"; }
die()   { printf '\n%sFAILED:%s %s\n\n' "$R" "$N" "$*" >&2; exit 1; }

have()  { command -v "$1" >/dev/null 2>&1; }

need() {
  have "$1" || die "$1 is not installed. Run ./scripts/setup-ec2.sh first."
}

# Wait for a condition, printing progress. Fails loudly with the resource state
# rather than a bare timeout, so students can see what is stuck.
wait_for() {
  local desc="$1" timeout="$2"; shift 2
  info "waiting for ${desc} (up to ${timeout}s)"
  local elapsed=0
  until "$@" >/dev/null 2>&1; do
    sleep 5; elapsed=$((elapsed + 5))
    if (( elapsed >= timeout )); then
      warn "timed out waiting for ${desc}"
      return 1
    fi
    printf '.'
  done
  echo
  ok "${desc} ready"
}

CLUSTER_NAME="${CLUSTER_NAME:-nexops}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
