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

THEHARVESTER_SOURCE_REPO_DEFAULT="https://github.com/laramies/theHarvester.git"
THEHARVESTER_VERSION_DEFAULT="4.9.2"
THEHARVESTER_SOURCE_REPO="${THEHARVESTER_SOURCE_REPO:-$THEHARVESTER_SOURCE_REPO_DEFAULT}"
THEHARVESTER_VERSION="${THEHARVESTER_VERSION:-$THEHARVESTER_VERSION_DEFAULT}"

python3 -m pip install "git+${THEHARVESTER_SOURCE_REPO}@${THEHARVESTER_VERSION}"

INFOGA_SOURCE_DEFAULT="https://github.com/robertswin/Infoga.git"
INFOGA_ARCHIVE_FALLBACK_DEFAULT="https://codeload.github.com/robertswin/Infoga/zip/refs/heads/master"
INFOGA_SOURCE="${INFOGA_SOURCE:-$INFOGA_SOURCE_DEFAULT}"
INFOGA_ARCHIVE_FALLBACK="${INFOGA_ARCHIVE_FALLBACK:-$INFOGA_ARCHIVE_FALLBACK_DEFAULT}"
INFOGA_SRC_DIR="./.venv/tools/infoga-src"
INFOGA_CMD_WRAPPER="./.venv/bin/infoga"

install_infoga_from_git() {
  local repo_url="$1"
  rm -rf "${INFOGA_SRC_DIR}"
  mkdir -p "$(dirname "${INFOGA_SRC_DIR}")"
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 "${repo_url}" "${INFOGA_SRC_DIR}"
}

install_infoga_from_archive() {
  local archive_url="$1"
  local tmp_archive tmp_extract
  tmp_archive="$(mktemp)"
  tmp_extract="$(mktemp -d)"

  curl -fsSL "${archive_url}" -o "${tmp_archive}"
  rm -rf "${INFOGA_SRC_DIR}"
  mkdir -p "$(dirname "${INFOGA_SRC_DIR}")"

  unzip -q "${tmp_archive}" -d "${tmp_extract}"
  local extracted
  extracted="$(find "${tmp_extract}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "${extracted}" ]]; then
    echo "Infoga archive extraction failed: folder hasil ekstraksi tidak ditemukan." >&2
    rm -f "${tmp_archive}"
    rm -rf "${tmp_extract}"
    return 1
  fi

  mv "${extracted}" "${INFOGA_SRC_DIR}"
  rm -f "${tmp_archive}"
  rm -rf "${tmp_extract}"
}

if [[ "${INFOGA_SOURCE}" =~ ^git\+https:// ]]; then
  INFOGA_SOURCE="${INFOGA_SOURCE#git+}"
fi

if [[ "${INFOGA_SOURCE}" =~ ^https://.*\.git$ ]]; then
  if ! install_infoga_from_git "${INFOGA_SOURCE}"; then
    echo "Infoga installation failed from git source: ${INFOGA_SOURCE}" >&2
    echo "Trying fallback source (non-git archive): ${INFOGA_ARCHIVE_FALLBACK}" >&2
    if ! install_infoga_from_archive "${INFOGA_ARCHIVE_FALLBACK}"; then
      echo "Infoga fallback installation also failed from source: ${INFOGA_ARCHIVE_FALLBACK}" >&2
      echo "Hint: repo Infoga bukan Python package pip-ready (tanpa setup.py/pyproject.toml), jadi installer memakai clone/archive source langsung." >&2
      echo "Troubleshooting: cek kemungkinan git credential helper / git config url.*.insteadof global yang menyisipkan auth ke URL publik." >&2
      echo "Contoh override: INFOGA_SOURCE='https://github.com/robertswin/Infoga.git' ./scripts/setup_sherlock.sh" >&2
      exit 1
    fi
  fi
elif [[ "${INFOGA_SOURCE}" =~ ^https:// ]]; then
  if ! install_infoga_from_archive "${INFOGA_SOURCE}"; then
    echo "Infoga installation failed from archive source: ${INFOGA_SOURCE}" >&2
    echo "Hint: package 'infoga' memang tidak tersedia di PyPI. Gunakan source git, archive publik, atau mirror internal." >&2
    echo "Contoh override: INFOGA_SOURCE='https://github.com/robertswin/Infoga.git' ./scripts/setup_sherlock.sh" >&2
    exit 1
  fi
else
  echo "INFOGA_SOURCE tidak valid: ${INFOGA_SOURCE}" >&2
  echo "Gunakan URL https://... atau git+https://..." >&2
  exit 1
fi

cat > "${INFOGA_CMD_WRAPPER}" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFOGA_SCRIPT="${SCRIPT_DIR}/../tools/infoga-src/infoga.py"

if [[ ! -f "${INFOGA_SCRIPT}" ]]; then
  echo "Infoga source tidak ditemukan di ${INFOGA_SCRIPT}" >&2
  exit 1
fi

if command -v python2 >/dev/null 2>&1; then
  exec python2 "${INFOGA_SCRIPT}" "$@"
fi

if command -v python2.7 >/dev/null 2>&1; then
  exec python2.7 "${INFOGA_SCRIPT}" "$@"
fi

echo "Infoga membutuhkan interpreter Python 2 (python2/python2.7) yang tidak ditemukan di server." >&2
exit 1
WRAPPER
chmod +x "${INFOGA_CMD_WRAPPER}"

SHERLOCK_CMD="./.venv/bin/sherlock"
HOLEHE_CMD="./.venv/bin/holehe"
MAIGRET_CMD="./.venv/bin/maigret"
THEHARVESTER_CMD="./.venv/bin/theHarvester"
INFOGA_CMD="./.venv/bin/infoga"
VERIFICATION_STATUS="PASS"

if [[ ! -f "${THEHARVESTER_CMD}" || ! -x "${THEHARVESTER_CMD}" ]]; then
  VERIFICATION_STATUS="FAIL"
  echo "theHarvester installation failed: executable ${THEHARVESTER_CMD} tidak ditemukan atau tidak executable." >&2
  echo "theHarvester source: git+${THEHARVESTER_SOURCE_REPO}@${THEHARVESTER_VERSION}" >&2
  echo "Final command (.env): THEHARVESTER_CMD=${THEHARVESTER_CMD}" >&2
  echo "Verification status: ${VERIFICATION_STATUS}" >&2
  exit 1
fi

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
  echo "Infoga verification failed: source sudah terpasang, tetapi runtime Infoga (umumnya Python 2) belum siap." >&2
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
