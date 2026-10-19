#!/usr/bin/env bash
# klipper-auto-eject installer
# https://github.com/ahmedbebars/klipper-auto-eject
#
# Copyright (C) 2026 Ahmed Bebars
# This file may be distributed under the terms of the GNU GPLv3 license.

set -euo pipefail

REPO_URL="https://github.com/ahmedbebars/klipper-auto-eject.git"
REPO_DIR="${HOME}/klipper-auto-eject"
CONFIG_DIR="${HOME}/printer_data/config"
MOONRAKER_CONF=""
ADD_INCLUDE=1
ADD_UPDATE_MANAGER=1
UNINSTALL=0
BRANCH="main"

usage() {
    cat <<EOF
Usage: install.sh [options]

  -c, --config-dir DIR    Klipper config directory (default: ~/printer_data/config)
  -r, --repo-dir DIR      Where to keep the repository (default: ~/klipper-auto-eject)
  -b, --branch NAME       Git branch to install (default: main)
      --no-include        Do not add [include] lines to printer.cfg
      --no-update-manager Do not add the Moonraker update_manager section
  -u, --uninstall         Remove links, includes and the update_manager section
  -h, --help              Show this help
EOF
}

log()  { printf '\033[1;32m[auto-eject]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[auto-eject]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[auto-eject]\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--config-dir)      CONFIG_DIR="$2"; shift 2 ;;
        -r|--repo-dir)        REPO_DIR="$2"; shift 2 ;;
        -b|--branch)          BRANCH="$2"; shift 2 ;;
        --no-include)         ADD_INCLUDE=0; shift ;;
        --no-update-manager)  ADD_UPDATE_MANAGER=0; shift ;;
        -u|--uninstall)       UNINSTALL=1; shift ;;
        -h|--help)            usage; exit 0 ;;
        *) usage; die "Unknown option: $1" ;;
    esac
done

[[ "$(id -u)" -eq 0 ]] && die "Do not run this script as root."
[[ -d "${CONFIG_DIR}" ]] || die "Config directory not found: ${CONFIG_DIR} (use --config-dir)"
PRINTER_CFG="${CONFIG_DIR}/printer.cfg"
MOONRAKER_CONF="${CONFIG_DIR}/moonraker.conf"
STAMP="$(date +%Y%m%d-%H%M%S)"

# When run from a checkout, use that checkout instead of cloning a new one.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
FROM_CHECKOUT=0
if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/config/auto_eject.cfg" ]]; then
    REPO_DIR="${SCRIPT_DIR}"
    FROM_CHECKOUT=1
fi

backup() {
    local file="$1"
    cp -p "${file}" "${file}.bak-auto-eject-${STAMP}"
    log "Backup: ${file}.bak-auto-eject-${STAMP}"
}

# ---------------------------------------------------------------- uninstall
if [[ "${UNINSTALL}" -eq 1 ]]; then
    if [[ -L "${CONFIG_DIR}/auto_eject.cfg" ]]; then
        rm -f "${CONFIG_DIR}/auto_eject.cfg"
        log "Removed link ${CONFIG_DIR}/auto_eject.cfg"
    fi
    if [[ -f "${PRINTER_CFG}" ]] && grep -q '^\[include auto_eject' "${PRINTER_CFG}"; then
        backup "${PRINTER_CFG}"
        sed -i '/^\[include auto_eject\(_settings\)\?\.cfg\]/d' "${PRINTER_CFG}"
        log "Removed [include] lines from printer.cfg"
    fi
    if [[ -f "${MOONRAKER_CONF}" ]] && grep -q '^\[update_manager klipper-auto-eject\]' "${MOONRAKER_CONF}"; then
        backup "${MOONRAKER_CONF}"
        awk '
            /^\[update_manager klipper-auto-eject\]/ { skip = 1; next }
            /^\[/ { skip = 0 }
            !skip
        ' "${MOONRAKER_CONF}" > "${MOONRAKER_CONF}.tmp" && mv "${MOONRAKER_CONF}.tmp" "${MOONRAKER_CONF}"
        log "Removed [update_manager klipper-auto-eject] from moonraker.conf"
    fi
    log "Kept ${CONFIG_DIR}/auto_eject_settings.cfg and ${REPO_DIR} (delete them by hand if you want)."
    log "Restart Klipper to finish: FIRMWARE_RESTART"
    exit 0
fi

# ------------------------------------------------------------- get the code
command -v git >/dev/null || die "git is required"
if [[ "${FROM_CHECKOUT}" -eq 1 ]]; then
    log "Using the repository at ${REPO_DIR}"
elif [[ -d "${REPO_DIR}/.git" ]]; then
    log "Updating ${REPO_DIR}"
    git -C "${REPO_DIR}" pull --ff-only
else
    log "Cloning into ${REPO_DIR}"
    git clone --branch "${BRANCH}" "${REPO_URL}" "${REPO_DIR}"
fi

# ------------------------------------------------------------- config files
ln -sfn "${REPO_DIR}/config/auto_eject.cfg" "${CONFIG_DIR}/auto_eject.cfg"
log "Linked ${CONFIG_DIR}/auto_eject.cfg -> ${REPO_DIR}/config/auto_eject.cfg"

if [[ -e "${CONFIG_DIR}/auto_eject_settings.cfg" ]]; then
    log "Keeping your existing auto_eject_settings.cfg"
else
    cp "${REPO_DIR}/config/auto_eject_settings.cfg" "${CONFIG_DIR}/auto_eject_settings.cfg"
    log "Created ${CONFIG_DIR}/auto_eject_settings.cfg - edit it for your printer"
fi

# ---------------------------------------------------------- printer.cfg
if [[ "${ADD_INCLUDE}" -eq 1 ]]; then
    [[ -f "${PRINTER_CFG}" ]] || die "printer.cfg not found in ${CONFIG_DIR}"
    if grep -q '^\[include auto_eject\.cfg\]' "${PRINTER_CFG}"; then
        log "printer.cfg already includes auto_eject.cfg"
    else
        backup "${PRINTER_CFG}"
        # insert before the SAVE_CONFIG block if there is one
        awk '
            !done && /^#\*# <-+ SAVE_CONFIG -+>/ {
                print "[include auto_eject.cfg]"
                print "[include auto_eject_settings.cfg]"
                print ""
                done = 1
            }
            { print }
            END {
                if (!done) {
                    print ""
                    print "[include auto_eject.cfg]"
                    print "[include auto_eject_settings.cfg]"
                }
            }
        ' "${PRINTER_CFG}" > "${PRINTER_CFG}.tmp" && mv "${PRINTER_CFG}.tmp" "${PRINTER_CFG}"
        log "Added [include] lines to printer.cfg"
    fi
fi

# --------------------------------------------------------- moonraker.conf
if [[ "${ADD_UPDATE_MANAGER}" -eq 1 ]]; then
    if [[ ! -f "${MOONRAKER_CONF}" ]]; then
        warn "moonraker.conf not found, skipping update_manager (see docs/installation.md)"
    elif grep -q '^\[update_manager klipper-auto-eject\]' "${MOONRAKER_CONF}"; then
        log "moonraker.conf already has the update_manager section"
    else
        backup "${MOONRAKER_CONF}"
        cat >> "${MOONRAKER_CONF}" <<EOF

[update_manager klipper-auto-eject]
type: git_repo
path: ${REPO_DIR}
origin: ${REPO_URL}
primary_branch: ${BRANCH}
is_system_service: False
EOF
        log "Added [update_manager klipper-auto-eject] to moonraker.conf (restart Moonraker to see it)"
    fi
fi

cat <<EOF

  Installed. Next steps:
    1. Edit auto_eject_settings.cfg (blade size, push direction, currents).
    2. Restart Klipper:            FIRMWARE_RESTART
    3. Watch a dry run first:      AUTO_EJECT DRY=1
    4. Read docs/safety.md before running it unattended.

EOF
