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

INFOGA_PIP_SOURCE_DEFAULT="git+https://github.com/robertswin/Infoga.git"
INFOGA_PIP_SOURCE_FALLBACK_DEFAULT="https://codeload.github.com/robertswin/Infoga/zip/refs/heads/master"
INFOGA_PIP_SOURCE="${INFOGA_PIP_SOURCE:-$INFOGA_PIP_SOURCE_DEFAULT}"

if ! GIT_TERMINAL_PROMPT=0 python3 -m pip install "${INFOGA_PIP_SOURCE}"; then
  echo "Infoga installation failed from source: ${INFOGA_PIP_SOURCE}" >&2
  if [[ "${INFOGA_PIP_SOURCE}" == git+https://* ]]; then
    echo "Trying fallback source (non-git archive): ${INFOGA_PIP_SOURCE_FALLBACK_DEFAULT}" >&2
    if ! GIT_TERMINAL_PROMPT=0 python3 -m pip install "${INFOGA_PIP_SOURCE_FALLBACK_DEFAULT}"; then
      echo "Infoga fallback installation also failed from source: ${INFOGA_PIP_SOURCE_FALLBACK_DEFAULT}" >&2
      echo "Hint: package 'infoga' memang tidak tersedia di PyPI. Gunakan source git, archive publik, atau mirror internal." >&2
      echo "Troubleshooting: cek kemungkinan git credential helper / git config url.*.insteadof global yang menyisipkan auth ke URL publik." >&2
      echo "Contoh override: INFOGA_PIP_SOURCE='git+https://github.com/robertswin/Infoga.git' ./scripts/setup_sherlock.sh" >&2
      exit 1
    fi
  else
    echo "Fallback non-git archive tidak dijalankan karena source bukan git+https URL." >&2
    echo "Hint: package 'infoga' memang tidak tersedia di PyPI. Gunakan source git, archive publik, atau mirror internal." >&2
    echo "Troubleshooting: cek kemungkinan git credential helper / git config url.*.insteadof global yang menyisipkan auth ke URL publik." >&2
    echo "Contoh override: INFOGA_PIP_SOURCE='git+https://github.com/robertswin/Infoga.git' ./scripts/setup_sherlock.sh" >&2
    exit 1
  fi
fi

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
