#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install sherlock-project
python3 -m pip install holehe

SHERLOCK_CMD="./.venv/bin/sherlock"
HOLEHE_CMD="./.venv/bin/holehe"
VERIFICATION_STATUS="PASS"

if ! ${SHERLOCK_CMD} --help >/dev/null 2>&1; then
  VERIFICATION_STATUS="FAIL"
  echo "Sherlock verification failed: dependency sistem belum lengkap atau instalasi Python package gagal." >&2
  echo "Final command (.env): SHERLOCK_CMD=${SHERLOCK_CMD}" >&2
  echo "Verification status: ${VERIFICATION_STATUS}" >&2
  exit 1
fi

if ! ${HOLEHE_CMD} --help >/dev/null 2>&1; then
  VERIFICATION_STATUS="FAIL"
  echo "Holehe verification failed: dependency sistem belum lengkap atau instalasi Python package gagal." >&2
  echo "Final command (.env): HOLEHE_CMD=${HOLEHE_CMD}" >&2
  echo "Verification status: ${VERIFICATION_STATUS}" >&2
  exit 1
fi

echo "Sherlock dan Holehe terpasang di virtualenv .venv"
echo "Final command (.env): SHERLOCK_CMD=${SHERLOCK_CMD}"
echo "Final command (.env): HOLEHE_CMD=${HOLEHE_CMD}"
echo "Verification status: ${VERIFICATION_STATUS}"
