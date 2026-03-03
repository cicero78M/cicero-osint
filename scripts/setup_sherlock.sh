#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install sherlock-project

echo "Sherlock installed in virtualenv .venv"
echo "Set SHERLOCK_CMD=./.venv/bin/python -m sherlock in your .env"
