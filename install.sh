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
REMOTE=0
TAILNET="100.64.0.0/10"
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
  -R, --remote            Also set up remote access with Tailscale: watch and
                          control the printer from your phone, from anywhere.
                          Asks before every step (docs/remote-access.md)
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
        -R|--remote)          REMOTE=1; shift ;;
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

# A yes/no question; $2 is the answer when you just press Enter (y or n).
# Without a terminal (piped install) the default is taken.
ask() {
    local answer hint="[y/N]"
    [[ "${2:-n}" == "y" ]] && hint="[Y/n]"
    if [[ ! -t 0 ]]; then
        [[ "${2:-n}" == "y" ]]
        return
    fi
    read -r -p "$(printf '\033[1;36m[auto-eject]\033[0m %s %s ' "$1" "${hint}")" answer
    [[ "${answer:-${2:-n}}" =~ ^[Yy] ]]
}

# --------------------------------------------------------- remote access
moonraker_port() {
    local port
    port="$(awk -F'[:=]' '/^\[server\]/ { s = 1; next } /^\[/ { s = 0 }
        s && $1 ~ /^port[[:space:]]*$/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' "${MOONRAKER_CONF}" 2>/dev/null)"
    echo "${port:-7125}"
}

# Moonraker reads moonraker.conf only when it starts. Restart it through its
# own API, and never while printing.
restart_moonraker() {
    local url state
    url="http://127.0.0.1:$(moonraker_port)"
    state="$(curl -s -m 5 "${url}/printer/objects/query?print_stats=state" 2>/dev/null || true)"
    if [[ -z "${state}" || "${state}" == *'"printing"'* || "${state}" == *'"paused"'* ]]; then
        warn "Restart Moonraker when the printer is idle to apply it (Mainsail: Machine > Moonraker > Restart)."
        return
    fi
    if curl -s -m 10 -X POST "${url}/machine/services/restart?service=moonraker" >/dev/null; then
        log "Moonraker restarted"
    else
        warn "Could not restart Moonraker: restart it from Mainsail (Machine > Moonraker > Restart)."
    fi
}

install_remote() {
    local ip name
    log "Remote access with Tailscale, see docs/remote-access.md"
    if ! command -v tailscale >/dev/null; then
        if ask "Tailscale is not installed. Install it now with the official installer from tailscale.com? (asks for your sudo password)" n; then
            curl -fsSL https://tailscale.com/install.sh | sh
        else
            warn "Skipped. Install Tailscale (tailscale.com/download), then run install.sh --remote again."
            return
        fi
    fi
    if ! tailscale status >/dev/null 2>&1; then
        if ask "Connect this printer to your Tailscale account now? A login link is shown, open it on any device." y; then
            sudo tailscale up
        else
            warn "Skipped. Connect it later with: sudo tailscale up"
            return
        fi
    fi
    ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
    name="$(tailscale status --json 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"].get("DNSName", "").rstrip("."))' 2>/dev/null || true)"
    log "This printer on your Tailscale network: ${ip:-?}${name:+ (${name})}"

    if [[ ! -f "${MOONRAKER_CONF}" ]]; then
        warn "moonraker.conf not found: add ${TAILNET} to [authorization] trusted_clients by hand (docs/remote-access.md)"
    elif ask "Let the devices on your Tailscale network use Mainsail and the auto-eject page? (adds ${TAILNET} to Moonraker's trusted_clients)" y; then
        backup "${MOONRAKER_CONF}"
        case "$(python3 "${REPO_DIR}/tools/moonraker_trust.py" add "${MOONRAKER_CONF}" "${TAILNET}")" in
            added) log "Added ${TAILNET} to trusted_clients"; restart_moonraker ;;
            present) log "trusted_clients already has ${TAILNET}" ;;
            no-authorization) log "Moonraker has no [authorization] section, so it accepts every device already" ;;
            *) warn "Could not change moonraker.conf: add ${TAILNET} to trusted_clients by hand" ;;
        esac
    fi

    if [[ -n "${name}" ]] && ask "Also serve the printer over HTTPS at https://${name}/ ? Phones need it to install the page as an app and for its notifications." y; then
        if sudo tailscale serve --bg 80; then
            log "HTTPS is on"
        else
            warn "tailscale serve did not start. Turn on MagicDNS and HTTPS Certificates in the Tailscale admin console (DNS page), then run: sudo tailscale serve --bg 80"
        fi
    fi
    REMOTE_URL="http://${ip:-<tailscale-ip>}"
    if [[ -n "${name}" ]] && tailscale serve status 2>/dev/null | grep -q "${name}"; then
        REMOTE_URL="https://${name}"
    fi
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
    if [[ -f "${MOONRAKER_CONF}" ]] && command -v python3 >/dev/null && [[ -f "${REPO_DIR}/tools/moonraker_trust.py" ]] \
        && [[ "$(python3 "${REPO_DIR}/tools/moonraker_trust.py" remove "${MOONRAKER_CONF}" "${TAILNET}")" == "removed" ]]; then
        log "Removed ${TAILNET} from Moonraker's trusted_clients (restart Moonraker to apply it)"
        log "Tailscale itself was left installed. To stop serving HTTPS: sudo tailscale serve --https=443 off"
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

# ------------------------------------------------------------- web page
if [[ "${WEB}" -eq 1 ]]; then
    install_web
fi

REMOTE_URL=""
if [[ "${REMOTE}" -eq 1 ]]; then
    install_remote
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
if [[ -n "${REMOTE_URL}" ]]; then
    echo "  From your phone (with the Tailscale app on): ${REMOTE_URL}/"
    echo "  The auto-eject page:                          ${REMOTE_URL}/auto-eject/"
else
    echo "  Optional: watch and control it from your phone, from anywhere:"
    echo "    ${REPO_DIR}/install.sh --remote   (docs/remote-access.md)"
fi
echo
