#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install sherlock-project
python3 -m pip install holehe
python3 -m pip install maigret
python3 -m pip install theHarvester
python3 -m pip install infoga

SHERLOCK_CMD="./.venv/bin/sherlock"
HOLEHE_CMD="./.venv/bin/holehe"
MAIGRET_CMD="./.venv/bin/maigret"
THEHARVESTER_CMD="./.venv/bin/theHarvester"
INFOGA_CMD="./.venv/bin/infoga"
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

if ! ${MAIGRET_CMD} --help >/dev/null 2>&1; then
  VERIFICATION_STATUS="FAIL"
  echo "Maigret verification failed: dependency sistem belum lengkap atau instalasi Python package gagal." >&2
  echo "Final command (.env): MAIGRET_CMD=${MAIGRET_CMD}" >&2
  echo "Verification status: ${VERIFICATION_STATUS}" >&2
  exit 1
fi

if ! ${THEHARVESTER_CMD} --help >/dev/null 2>&1; then
  VERIFICATION_STATUS="FAIL"
  echo "theHarvester verification failed: dependency sistem belum lengkap atau instalasi Python package gagal." >&2
  echo "Final command (.env): THEHARVESTER_CMD=${THEHARVESTER_CMD}" >&2
  echo "Verification status: ${VERIFICATION_STATUS}" >&2
  exit 1
fi

if ! ${INFOGA_CMD} --help >/dev/null 2>&1; then
  VERIFICATION_STATUS="FAIL"
  echo "Infoga verification failed: dependency sistem belum lengkap atau instalasi Python package gagal." >&2
  echo "Final command (.env): INFOGA_CMD=${INFOGA_CMD}" >&2
  echo "Verification status: ${VERIFICATION_STATUS}" >&2
  exit 1
fi

echo "Sherlock, Holehe, Maigret, theHarvester, dan Infoga terpasang di virtualenv .venv"
echo "Final command (.env): SHERLOCK_CMD=${SHERLOCK_CMD}"
echo "Final command (.env): HOLEHE_CMD=${HOLEHE_CMD}"
echo "Final command (.env): MAIGRET_CMD=${MAIGRET_CMD}"
echo "Final command (.env): THEHARVESTER_CMD=${THEHARVESTER_CMD}"
echo "Final command (.env): INFOGA_CMD=${INFOGA_CMD}"
echo "Verification status: ${VERIFICATION_STATUS}"
