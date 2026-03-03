#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

if [[ ! -d ".venv-theharvester" ]]; then
  python3 -m venv .venv-theharvester
fi

source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install sherlock-project
python3 -m pip install holehe
python3 -m pip install maigret
python3 -m pip install instaloader

# Pastikan dependency Maigret kompatibel.
# Urutan instalasi sherlock/holehe sering menurunkan versi aiohttp/requests/lxml,
# sehingga import Maigret gagal (contoh: aiohttp.abc.ResolveResult tidak ada di aiohttp lama).
python3 -m pip install --upgrade \
  "aiohttp>=3.12.14,<4.0.0" \
  "aiohttp-socks>=0.10.1,<0.11.0" \
  "async-timeout>=5.0.1,<6.0.0" \
  "certifi>=2025.6.15,<2026.0.0" \
  "lxml>=5.4.0,<6.0.0" \
  "requests>=2.32.4,<3.0.0"

THEHARVESTER_SOURCE_REPO_DEFAULT="https://github.com/laramies/theHarvester.git"
THEHARVESTER_VERSION_DEFAULT="4.9.2"
THEHARVESTER_LEGACY_VERSION_DEFAULT="4.6.0"
THEHARVESTER_SOURCE_REPO="${THEHARVESTER_SOURCE_REPO:-$THEHARVESTER_SOURCE_REPO_DEFAULT}"

if [[ -n "${THEHARVESTER_VERSION:-}" ]]; then
  THEHARVESTER_VERSION="${THEHARVESTER_VERSION}"
else
  if python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)'; then
    THEHARVESTER_VERSION="${THEHARVESTER_VERSION_DEFAULT}"
  else
    THEHARVESTER_VERSION="${THEHARVESTER_LEGACY_VERSION_DEFAULT}"
    echo "Python $(python3 -V 2>&1) terdeteksi < 3.12. Menggunakan theHarvester ${THEHARVESTER_VERSION} agar kompatibel." >&2
  fi
fi

./.venv-theharvester/bin/python3 -m pip install --upgrade pip
./.venv-theharvester/bin/python3 -m pip install "git+${THEHARVESTER_SOURCE_REPO}@${THEHARVESTER_VERSION}"

cat > ./.venv/bin/theHarvester <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEHARVESTER_BIN="${SCRIPT_DIR}/../../.venv-theharvester/bin/theHarvester"

if [[ ! -x "${THEHARVESTER_BIN}" ]]; then
  echo "theHarvester binary tidak ditemukan di ${THEHARVESTER_BIN}" >&2
  exit 1
fi

exec "${THEHARVESTER_BIN}" "$@"
WRAPPER
chmod +x ./.venv/bin/theHarvester


SHERLOCK_CMD="./.venv/bin/sherlock"
HOLEHE_CMD="./.venv/bin/holehe"
MAIGRET_CMD="./.venv/bin/maigret"
INSTALOADER_CMD="./.venv/bin/instaloader"
THEHARVESTER_CMD="./.venv/bin/theHarvester"
VERIFICATION_STATUS="PASS"
SETUP_LOG_FILE="./.venv/setup_sherlock.log"

mkdir -p "$(dirname "${SETUP_LOG_FILE}")"
: > "${SETUP_LOG_FILE}"

detect_failure_reason() {
  local output="$1"

  if [[ "${output}" == *"No such file or directory"* ]] || [[ "${output}" == *"not found"* ]]; then
    echo "executable tidak ditemukan"
    return
  fi

  if [[ "${output}" == *"ModuleNotFoundError"* ]] || [[ "${output}" == *"ImportError"* ]]; then
    echo "module import error"
    return
  fi

  if [[ "${output}" == *"command not found"* ]]; then
    echo "dependency OS hilang"
    return
  fi


  echo "dependency sistem belum lengkap atau instalasi package gagal"
}

verify_tool_command() {
  local tool_name="$1"
  local env_key="$2"
  local cmd_path="$3"
  local help_arg="$4"
  local result_file
  local output
  local reason

  result_file="$(mktemp)"

  if ! "${cmd_path}" "${help_arg}" >"${result_file}" 2>&1; then
    output="$(cat "${result_file}")"
    reason="$(detect_failure_reason "${output}")"

    {
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${tool_name} verification failed"
      echo "Final command (.env): ${env_key}=${cmd_path}"
      cat "${result_file}"
      echo ""
    } >> "${SETUP_LOG_FILE}"

    VERIFICATION_STATUS="FAIL"
    echo "${tool_name} verification failed: ${reason}." >&2
    echo "Final command (.env): ${env_key}=${cmd_path}" >&2
    echo "Output cuplikan (${tool_name}):" >&2
    sed -n '1,20p' "${result_file}" >&2
    echo "Log lengkap verifikasi: ${SETUP_LOG_FILE}" >&2
    echo "Verification status: ${VERIFICATION_STATUS}" >&2

    rm -f "${result_file}"
    exit 1
  fi

  rm -f "${result_file}"
}

if [[ ! -f "${THEHARVESTER_CMD}" || ! -x "${THEHARVESTER_CMD}" ]]; then
  VERIFICATION_STATUS="FAIL"
  echo "theHarvester installation failed: executable ${THEHARVESTER_CMD} tidak ditemukan atau tidak executable." >&2
  echo "theHarvester source: git+${THEHARVESTER_SOURCE_REPO}@${THEHARVESTER_VERSION}" >&2
  echo "Final command (.env): THEHARVESTER_CMD=${THEHARVESTER_CMD}" >&2
  echo "Verification status: ${VERIFICATION_STATUS}" >&2
  exit 1
fi

verify_tool_command "Sherlock" "SHERLOCK_CMD" "${SHERLOCK_CMD}" "--help"
verify_tool_command "Holehe" "HOLEHE_CMD" "${HOLEHE_CMD}" "--help"
verify_tool_command "Maigret" "MAIGRET_CMD" "${MAIGRET_CMD}" "--help"
verify_tool_command "Instaloader" "INSTALOADER_CMD" "${INSTALOADER_CMD}" "--help"
verify_tool_command "theHarvester" "THEHARVESTER_CMD" "${THEHARVESTER_CMD}" "--help"

echo "Sherlock, Holehe, Maigret, Instaloader, theHarvester terpasang di virtualenv .venv"
echo "Final command (.env): SHERLOCK_CMD=${SHERLOCK_CMD}"
echo "Final command (.env): HOLEHE_CMD=${HOLEHE_CMD}"
echo "Final command (.env): MAIGRET_CMD=${MAIGRET_CMD}"
echo "Final command (.env): INSTALOADER_CMD=${INSTALOADER_CMD}"
echo "Final command (.env): THEHARVESTER_CMD=${THEHARVESTER_CMD}"
echo "Verification status: ${VERIFICATION_STATUS}"
