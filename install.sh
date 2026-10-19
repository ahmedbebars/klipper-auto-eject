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
WEB=0
BRANCH="main"
NGINX_SNIPPET="/etc/nginx/auto-eject.conf"

usage() {
    cat <<EOF
Usage: install.sh [options]

  -c, --config-dir DIR    Klipper config directory (default: ~/printer_data/config)
  -r, --repo-dir DIR      Where to keep the repository (default: ~/klipper-auto-eject)
  -b, --branch NAME       Git branch to install (default: main)
      --no-include        Do not add [include] lines to printer.cfg
      --no-update-manager Do not add the Moonraker update_manager section
  -w, --web               Also set up the web page at http://<printer>/auto-eject/
                          (adds a small nginx file, asks for your sudo password)
  -u, --uninstall         Remove links, includes, the update_manager section
                          and the web page
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
        -w|--web)             WEB=1; shift ;;
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

# ------------------------------------------------------------- web page
# nginx site files that serve Mainsail or Fluidd
nginx_sites() {
    local f
    for f in /etc/nginx/sites-enabled/*; do
        [[ -f "${f}" ]] || continue
        if grep -Eq '^[[:space:]]*root[[:space:]].*/(mainsail|fluidd)' "${f}"; then
            readlink -f "${f}"
        fi
    done
}

# The Mainsail sidebar link (Fluidd has no custom links: bookmark the page).
navi_entry() {
    local action="$1" theme="${CONFIG_DIR}/.theme"
    command -v python3 >/dev/null || { warn "python3 not found, skipping the Mainsail sidebar link"; return; }
    if [[ "${action}" == "remove" ]]; then
        grep -qs '/auto-eject/web/' "${theme}/navi.json" || return 0
    fi
    mkdir -p "${theme}"
    if ! python3 - "${theme}/navi.json" "${action}" <<'PY'
import json, os, sys
path, action = sys.argv[1], sys.argv[2]
entry = {"title": "Auto-eject", "href": "/auto-eject/web/", "target": "_self", "position": 35,
         "icon": "M2 11h12V7l6 5-6 5v-4H2z M20 4h2v16h-2z"}
data = []
if os.path.exists(path):
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except ValueError:
            sys.exit("navi.json is not valid JSON, not changing it: " + path)
data = [e for e in data if e.get("href") != entry["href"]]
if action == "add":
    data.append(entry)
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
    then
        warn "Could not change ${theme}/navi.json: add the sidebar link by hand (docs/web-page.md)"
    elif [[ "${action}" == "add" ]]; then
        log "Added the Auto-eject link to the Mainsail sidebar (${theme}/navi.json). Reload Mainsail to see it."
    else
        log "Removed the Auto-eject link from ${theme}/navi.json"
    fi
}

install_web() {
    command -v nginx >/dev/null || command -v /usr/sbin/nginx >/dev/null || [[ -d /etc/nginx ]] \
        || die "nginx not found. Set the page up by hand: docs/web-page.md"
    local sites
    sites="$(nginx_sites)"
    [[ -n "${sites}" ]] || die "No nginx site for Mainsail or Fluidd found in /etc/nginx/sites-enabled. Set the page up by hand: docs/web-page.md"
    log "The web page needs a small nginx file. sudo may ask for your password."
    sudo tee "${NGINX_SNIPPET}" >/dev/null <<EOF
# klipper-auto-eject web page, added by install.sh --web
# https://github.com/ahmedbebars/klipper-auto-eject/blob/main/docs/web-page.md
location = /auto-eject { return 302 /auto-eject/web/; }
location = /auto-eject/ { return 302 /auto-eject/web/; }
location ~ ^/auto-eject/(.*/)?\. { deny all; }
location /auto-eject/ {
    alias ${REPO_DIR}/;
    index index.html;
    add_header Cache-Control "no-cache";
}
EOF
    local site
    while IFS= read -r site; do
        if sudo grep -q "include ${NGINX_SNIPPET};" "${site}"; then
            log "${site} already includes the web page"
            continue
        fi
        # the backup goes next to nginx.conf, where nginx never loads it
        sudo cp -p "${site}" "/etc/nginx/$(basename "${site}").bak-auto-eject-${STAMP}"
        sudo sed -i "0,/^[[:space:]]*server[[:space:]]*{/s##&\n    include ${NGINX_SNIPPET};#" "${site}"
        log "Added the web page to ${site} (backup in /etc/nginx/)"
    done <<< "${sites}"
    if sudo nginx -t 2>/dev/null; then
        sudo systemctl reload nginx
        log "nginx reloaded"
    else
        warn "nginx does not accept the change, putting the old files back:"
        sudo nginx -t || true
        while IFS= read -r site; do
            [[ -f "/etc/nginx/$(basename "${site}").bak-auto-eject-${STAMP}" ]] && \
                sudo cp -p "/etc/nginx/$(basename "${site}").bak-auto-eject-${STAMP}" "${site}"
        done <<< "${sites}"
        sudo rm -f "${NGINX_SNIPPET}"
        die "Web page not installed. See docs/web-page.md to set it up by hand."
    fi
    navi_entry add
}

uninstall_web() {
    local site changed=0
    while IFS= read -r site; do
        [[ -n "${site}" ]] || continue
        if sudo grep -q "include ${NGINX_SNIPPET};" "${site}"; then
            sudo sed -i "\#include ${NGINX_SNIPPET};#d" "${site}"
            log "Removed the web page from ${site}"
            changed=1
        fi
    done <<< "$(nginx_sites)"
    if [[ -f "${NGINX_SNIPPET}" ]]; then
        sudo rm -f "${NGINX_SNIPPET}"
        changed=1
    fi
    if [[ "${changed}" -eq 1 ]]; then
        sudo nginx -t && sudo systemctl reload nginx
    fi
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
    if [[ -f "${NGINX_SNIPPET}" ]]; then
        uninstall_web
    fi
    navi_entry remove
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

# ------------------------------------------------------------- web page
if [[ "${WEB}" -eq 1 ]]; then
    install_web
fi

cat <<EOF

  Installed. Next steps:
    1. Edit auto_eject_settings.cfg (blade size, push direction, currents).
    2. Restart Klipper:            FIRMWARE_RESTART
    3. Watch a dry run first:      AUTO_EJECT DRY=1
    4. Read docs/safety.md before running it unattended.

EOF
if [[ "${WEB}" -eq 1 ]]; then
    echo "  The web page: http://$(hostname -I 2>/dev/null | awk '{print $1}')/auto-eject/"
else
    echo "  Optional: a web page with the bed map, the queue and the settings:"
    echo "    ${REPO_DIR}/install.sh --web      (docs/web-page.md)"
fi
echo
