#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install sherlock-project

SHERLOCK_CMD="./.venv/bin/sherlock"
VERIFICATION_STATUS="PASS"

if ! ${SHERLOCK_CMD} --help >/dev/null 2>&1; then
  VERIFICATION_STATUS="FAIL"
  echo "Sherlock verification failed: dependency sistem belum lengkap atau instalasi Python package gagal." >&2
  echo "Final command (.env): SHERLOCK_CMD=${SHERLOCK_CMD}" >&2
  echo "Verification status: ${VERIFICATION_STATUS}" >&2
  exit 1
fi

echo "Sherlock installed in virtualenv .venv"
echo "Final command (.env): SHERLOCK_CMD=${SHERLOCK_CMD}"
echo "Verification status: ${VERIFICATION_STATUS}"
