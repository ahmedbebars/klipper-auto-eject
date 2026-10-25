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
NOTIFY=0
PUSH=0
FARM=0
SPOOLMAN=0
SPOOLMAN_FOUND=""     # "url version" lines of the Spoolman servers found on the network
DEMON_ONLY=0
FIRMWARE=0
PLAIN=0              # --plain: the questions one by one, without the menu
# Moonraker's update manager restarts a service after an update only when it
# has the update_manager section's name, so the service is klipper-auto-eject
PUSH_NAME="klipper-auto-eject"
PUSH_UNIT="/etc/systemd/system/${PUSH_NAME}.service"
OLD_PUSH_UNIT="/etc/systemd/system/auto-eject-push.service"
TAILNET="100.64.0.0/10"
BRANCH="main"
NGINX_SNIPPET="/etc/nginx/auto-eject.conf"

usage() {
    cat <<EOF
Usage: install.sh [options]

Run it with no options from a terminal and it asks what to set up, on one
screen of tick boxes (with whiptail, or one question at a time without it).

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
  -P, --push              Also install the notification service: the auto-eject
                          app on your phone gets notifications even while it is
                          closed. Needs HTTPS (--remote) and sudo once
                          (docs/notifications.md)
  -F, --farm              All your printers on one page: the web page and the
                          klipper-auto-eject service on this printer, which
                          finds the others on the network. They need nothing
                          installed (docs/farm.md)
  -N, --notify            Also send notifications to your phone with the ntfy
                          app, Telegram or Discord: a part still on the bed, a
                          print that finished... (docs/notifications.md)
  -S, --spoolman          Link Moonraker to your Spoolman, so the queue stops
                          before a job the spool cannot finish. Asks where
                          Spoolman runs (docs/spoolman.md)
      --demon             With DEMON Klipper Essentials: check the bed from
                          DEMON's first hook (_CUSTOM_PRE_START) instead of the
                          slicer's start G-code, and nothing else. The install
                          does it too (docs/integration.md)
      --firmware          Bring the firmware of the printer's boards to Klipper's
                          version, and nothing else: it builds each board's
                          firmware, says what it will do and asks first. Never
                          while printing (docs/firmware.md)
      --plain             Ask the questions one at a time, without the menu
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
        -N|--notify)          NOTIFY=1; shift ;;
        -P|--push)            PUSH=1; shift ;;
        -F|--farm)            FARM=1; WEB=1; PUSH=1; shift ;;
        -S|--spoolman)        SPOOLMAN=1; shift ;;
        --demon)              DEMON_ONLY=1; shift ;;
        --firmware)           FIRMWARE=1; shift ;;
        --plain)             PLAIN=1; shift ;;
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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
FROM_CHECKOUT=0
if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/config/auto_eject.cfg" ]]; then
    REPO_DIR="${SCRIPT_DIR}"
    FROM_CHECKOUT=1
fi

backup() {
    local file="$1"
    [[ -e "${file}.bak-auto-eject-${STAMP}" ]] && return   # already saved as it was before this run
    cp -p "${file}" "${file}.bak-auto-eject-${STAMP}"
    log "Backup: ${file}.bak-auto-eject-${STAMP}"
}

# Put lines into printer.cfg above its SAVE_CONFIG block, or at the end.
insert_before_save_config() {
    awk -v block="$1" '
        !done && /^#\*# <-+ SAVE_CONFIG -+>/ { print block; print ""; done = 1 }
        { print }
        END { if (!done) { print ""; print block } }
    ' "${PRINTER_CFG}" > "${PRINTER_CFG}.tmp" && mv "${PRINTER_CFG}.tmp" "${PRINTER_CFG}"
}

# The [include] lines go with the printer's own ones at the top of
# printer.cfg, where people look for them: after the last [include] that
# comes before any other section. Without such a block, above SAVE_CONFIG.
# INCLUDE_LINE is where they landed.
insert_includes() {
    local last
    last=$(awk '/^\[include /{ last = NR; next } /^\[/{ exit } END { print last + 0 }' "${PRINTER_CFG}")
    if [[ "${last}" -gt 0 ]]; then
        awk -v block="$1" -v at="${last}" '{ print } NR == at { print block }' "${PRINTER_CFG}" > "${PRINTER_CFG}.tmp" &&
            mv "${PRINTER_CFG}.tmp" "${PRINTER_CFG}"
        INCLUDE_WHERE="with your other [include] lines"
    else
        insert_before_save_config "$1"
        INCLUDE_WHERE="above the SAVE_CONFIG block"
    fi
    INCLUDE_LINE=$(grep -n '^\[include auto_eject\.cfg\]' "${PRINTER_CFG}" | head -1 | cut -d: -f1)
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

# What to set up, as one screen of tick boxes. whiptail is on most printer
# hosts already; without it, or with --plain, this returns 1 and the
# questions are asked one at a time. A choice that needs another comes back
# to the screen with a word on why.
pick_with_menu() {
    if [[ "${PLAIN}" -eq 1 ]] || ! command -v whiptail >/dev/null; then
        return 1
    fi
    local on=() line spool="Spoolman: the queue stops before a spool runs out" width
    [[ "${ADD_INCLUDE}" -eq 1 ]] && on+=(blade)
    on+=(web)
    if [[ -n "${SPOOLMAN_FOUND}" ]]; then
        spool="Spoolman at ${SPOOLMAN_FOUND%% *}: stop before a spool runs out"
        on+=(spoolman)
    fi
    width="$(tput cols 2>/dev/null || echo 80)"
    (( width > 90 )) && width=90
    (( width < 60 )) && width=60
    tick() { [[ " ${on[*]} " == *" $1 "* ]] && echo ON || echo OFF; }
    while true; do
        line="$(whiptail --title "klipper-auto-eject" --separate-output --checklist \
            "Space ticks or clears a line, Enter goes on, Esc stops. Anything left out can be added later." \
            15 "${width}" 7 \
            blade "The blade pushes the prints off this printer" "$(tick blade)" \
            web "The auto-eject page in Mainsail: bed, queue, settings" "$(tick web)" \
            remote "Your phone, from anywhere (a free Tailscale account)" "$(tick remote)" \
            push "Notifications on the phone (needs the line above)" "$(tick push)" \
            farm "All your printers on one page (printer farm)" "$(tick farm)" \
            notify "Messages on Telegram, Discord or the ntfy app" "$(tick notify)" \
            spoolman "${spool}" "$(tick spoolman)" \
            3>&1 1>&2 2>&3)" || { log "Stopped: nothing was changed."; exit 0; }
        mapfile -t on <<<"${line}"
        if [[ " ${on[*]} " == *" push "* && " ${on[*]} " != *" remote "* ]]; then
            whiptail --title "klipper-auto-eject" --msgbox \
                "Notifications on the phone need the phone access above: the phone only takes them from an HTTPS address, which Tailscale gives. Tick both, or clear notifications." 10 "${width}"
            continue
        fi
        if [[ " ${on[*]} " == *" farm "* && " ${on[*]} " != *" web "* ]]; then
            whiptail --title "klipper-auto-eject" --msgbox \
                "The printer farm is a part of the auto-eject page. Tick the page too, or clear the farm." 9 "${width}"
            continue
        fi
        break
    done
    ADD_INCLUDE=0
    for line in "${on[@]}"; do
        case "${line}" in
            blade)    ADD_INCLUDE=1 ;;
            web)      WEB=1 ;;
            remote)   REMOTE=1 ;;
            push)     PUSH=1 ;;
            farm)     FARM=1; PUSH=1 ;;
            notify)   NOTIFY=1 ;;
            spoolman) SPOOLMAN=1 ;;
        esac
    done
}

# The config sections Klipper has loaded, from Moonraker; when Klipper does
# not answer, the ones written in the config files.
config_sections() {
    if curl -s -m 5 "http://127.0.0.1:$(moonraker_port)/printer/objects/query?configfile=config" 2>/dev/null \
        | python3 -c 'import json, sys; print("\n".join(json.load(sys.stdin)["result"]["status"]["configfile"]["config"]))' 2>/dev/null; then
        return
    fi
    grep -rhoE '^\[[A-Za-z0-9_ ]+\]' "${CONFIG_DIR}" --include='*.cfg' 2>/dev/null | tr -d '[]' || true
}

# DEMON Klipper Essentials stops the printer when its DEMON_START has not come
# a few seconds into a print, and checking the bed takes longer: with DEMON,
# AUTO_EJECT_GUARD runs in DEMON's first hook, inside DEMON_START. Returns 1
# without DEMON's user files.
setup_demon() {
    local action="$1" file="" f result
    for f in "${CONFIG_DIR}"/Demon_User_Files/demon_custom_expansion*.cfg; do
        [[ -f "${f}" ]] && file="${f}"
    done
    [[ -n "${file}" ]] || return 1
    if ! command -v python3 >/dev/null; then
        warn "python3 not found: put AUTO_EJECT_GUARD FROM=DEMON in DEMON's _CUSTOM_PRE_START by hand (docs/integration.md)"
        return 0
    fi
    if [[ "${action}" == "remove" ]]; then
        grep -qi 'AUTO_EJECT_GUARD' "${file}" || return 0
        backup "${file}"
        [[ "$(python3 "${REPO_DIR}/tools/demon_hook.py" remove "${file}")" == "removed" ]]             && log "Took AUTO_EJECT_GUARD out of DEMON's _CUSTOM_PRE_START (${file##*/})"
        return 0
    fi
    case "$(python3 "${REPO_DIR}/tools/demon_hook.py" status "${file}")" in
        present) log "DEMON already checks the bed first in every print (AUTO_EJECT_GUARD in _CUSTOM_PRE_START)" ;;
        absent)
            backup "${file}"
            result="$(python3 "${REPO_DIR}/tools/demon_hook.py" add "${file}")"
            if [[ "${result}" == "added" ]]; then
                CHANGED_CFG=1
                log "DEMON now checks the bed first in every print: AUTO_EJECT_GUARD FROM=DEMON in _CUSTOM_PRE_START (${file##*/})."
                log "An AUTO_EJECT_GUARD line in your slicer's start G-code is not needed any more: take it out, or leave it, it does nothing then."
            fi ;;
        *) warn "${file##*/} has no _CUSTOM_PRE_START: put AUTO_EJECT_GUARD FROM=DEMON in DEMON's first hook by hand (docs/integration.md)" ;;
    esac
    return 0
}

# auto-eject needs these Klipper sections; add the missing ones to printer.cfg.
REQUIRED_SECTIONS=(exclude_object respond save_variables)
CHANGED_CFG=0
add_required_sections() {
    local have s block missing=()
    have="$(config_sections | tr '[:upper:]' '[:lower:]')"
    for s in "${REQUIRED_SECTIONS[@]}"; do
        grep -qx "${s}" <<< "${have}" || missing+=("${s}")
    done
    if [[ ${#missing[@]} -eq 0 ]]; then
        log "Your config has [exclude_object], [respond] and [save_variables]"
        return
    fi
    log "auto-eject needs these sections, and your config lacks them: $(printf '[%s] ' "${missing[@]}")"
    if ! ask "Add them to printer.cfg?" y; then
        warn "Add them by hand before restarting Klipper (docs/installation.md#what-printercfg-needs)"
        return
    fi
    block="# added by klipper-auto-eject install.sh (docs/installation.md)"
    for s in "${missing[@]}"; do
        block+=$'\n'"[${s}]"
        if [[ "${s}" == "save_variables" ]]; then
            block+=$'\n'"filename: ${CONFIG_DIR}/variables.cfg"
            touch "${CONFIG_DIR}/variables.cfg"
        fi
    done
    backup "${PRINTER_CFG}"
    insert_before_save_config "${block}"
    CHANGED_CFG=1
    log "Added $(printf '[%s] ' "${missing[@]}")to printer.cfg"
}

# FIRMWARE_RESTART through Moonraker, so Klipper loads auto-eject; never while printing.
restart_klipper() {
    local url state
    url="http://127.0.0.1:$(moonraker_port)"
    state="$(curl -s -m 5 "${url}/printer/objects/query?print_stats=state&idle_timeout=state" 2>/dev/null || true)"
    if [[ -z "${state}" ]]; then
        warn "Klipper does not answer. Restart it from Mainsail: type FIRMWARE_RESTART in the console."
    elif [[ "${state}" == *'"printing"'* || "${state}" == *'"paused"'* || "${state}" == *'"Printing"'* ]]; then
        warn "The printer is busy. After the print, type FIRMWARE_RESTART in the console."
    elif curl -s -m 10 -X POST "${url}/printer/firmware_restart" >/dev/null; then
        log "Klipper restarted. If Mainsail shows an error, see docs/troubleshooting.md"
        RESTARTED=1
    else
        warn "Could not restart Klipper: type FIRMWARE_RESTART in the console."
    fi
}
RESTARTED=0

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
        # wait until the new Moonraker answers and is connected to Klipper again
        sleep 3
        for _ in $(seq 1 40); do
            curl -s -m 3 "${url}/server/info" 2>/dev/null | grep -q '"klippy_state": *"ready"' && break
            sleep 1
        done
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
            log "Open the link on any device, or scan the QR code with your phone. To copy the link, select it with the mouse: Ctrl+C here stops the login."
            # Ctrl+C (pressed to copy the link, often) stops the login only, not the whole setup
            local up=0
            trap 'true' INT
            sudo tailscale up --qr || up=$?
            trap - INT
            if [[ ${up} -ne 0 ]] || ! tailscale status >/dev/null 2>&1; then
                warn "The printer is not connected to Tailscale. The rest of the setup goes on; for remote access later run: ${REPO_DIR}/install.sh --remote"
                return
            fi
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

# ---------------------------------------------------------- notifications
# Run a G-code command through Moonraker once Klipper is ready again (after a
# Moonraker restart it reconnects within a few seconds).
moonraker_gcode() {
    local url ready=0
    url="http://127.0.0.1:$(moonraker_port)"
    for _ in $(seq 1 30); do
        if curl -s -m 3 "${url}/printer/info" 2>/dev/null | grep -q '"state": *"ready"'; then
            ready=1
            break
        fi
        sleep 1
    done
    [[ "${ready}" -eq 1 ]] || return 1
    for _ in 1 2 3; do
        if curl -s -m 15 -X POST -H "Content-Type: application/json" \
            -d "{\"script\": \"$1\"}" "${url}/printer/gcode/script" | grep -q '"result": *"ok"'; then
            return 0
        fi
        sleep 2
    done
    return 1
}

# A line typed at a prompt; hidden=1 keeps it off the screen (a token).
prompt_line() {
    local answer label
    label="$(printf '\033[1;36m[auto-eject]\033[0m %s ' "$1")"
    if [[ "${2:-0}" -eq 1 ]]; then
        read -rs -p "${label}" answer
        echo >&2
    else
        read -r -p "${label}" answer
    fi
    printf '%s' "${answer}"
}

install_notify() {
    local tool to="" topic kind service="ntfy" choice default=1 click="" events="error, cancelled" name ip token bot chat
    tool="${REPO_DIR}/tools/moonraker_notifier.py"
    log "Notifications on your phone: the ntfy app, Telegram or Discord, see docs/notifications.md"
    if [[ ! -f "${MOONRAKER_CONF}" ]]; then
        warn "moonraker.conf not found: set up a [notifier] by hand (docs/notifications.md)"
        return
    fi
    topic="$(python3 "${tool}" topic "${MOONRAKER_CONF}")"
    kind="$(python3 "${tool}" kind "${MOONRAKER_CONF}")"
    case "${kind}" in telegram) default=2 ;; discord) default=3 ;; esac
    if [[ "${kind}" == "telegram" || "${kind}" == "discord" || "${kind}" == "other" ]] \
        && ask "Notifications go to ${kind} already. Keep that?" y; then
        to="$(python3 "${tool}" url "${MOONRAKER_CONF}")"
        service="${kind}"
    elif [[ ! -t 0 ]]; then
        choice=1          # without a terminal nothing can be typed in: ntfy, as before
    else
        echo "    1) the ntfy app: free, no account"
        echo "    2) Telegram: a bot of your own, made in two minutes"
        echo "    3) Discord: a channel of your server"
        echo "    0) none"
        choice="$(prompt_line "Where should they go? [${default}]")"
        choice="${choice:-${default}}"
    fi
    if [[ -z "${to}" ]]; then
        case "${choice}" in
            0) return ;;
            2)
                service="telegram"
                log "In Telegram, open @BotFather and send /newbot; it gives you a token like 123456789:AAH..."
                token="$(prompt_line "Paste the bot's token (it stays hidden):" 1)"
                token="${token//[[:space:]]/}"
                bot="$(python3 "${tool}" bot "${token}")"
                if [[ -z "${bot}" ]]; then
                    warn "Telegram does not know that token. Copy it again from @BotFather, then run install.sh --notify again."
                    return
                fi
                log "Your bot is @${bot}. In Telegram, open @${bot} and send it any message (hi will do)."
                for _ in 1 2 3; do
                    prompt_line "Press Enter once you have sent it." >/dev/null
                    chat="$(python3 "${tool}" chat "${token}")"
                    [[ -n "${chat}" ]] && break
                    warn "No message has reached @${bot} yet."
                done
                if [[ -z "${chat}" ]]; then
                    warn "Send @${bot} a message, then run install.sh --notify again."
                    return
                fi
                log "The notifications go to ${chat#*$'\t'} on Telegram"
                to="tgram://${token}/${chat%%$'\t'*}"
                ;;
            3)
                service="discord"
                log "In Discord: Server Settings > Integrations > Webhooks > New Webhook, pick the channel, then Copy Webhook URL."
                to="$(python3 "${tool}" discord "$(prompt_line "Paste the webhook URL (it stays hidden):" 1)")"
                if [[ -z "${to}" ]]; then
                    warn "That is not a Discord webhook URL (https://discord.com/api/webhooks/...)."
                    return
                fi
                ;;
            *)
                if ! ask "The ntfy app is free; its messages go through the ntfy.sh server. Use it?" y; then
                    return
                fi
                [[ -n "${topic}" ]] || topic="auto-eject-$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
                to="${topic}"
                ;;
        esac
    fi
    if ask "Also a notification when every print finishes? With AUTO_EJECT in the end G-code it comes once the bed is clear." y; then
        events="complete, error, cancelled"
    fi
    if [[ "${service}" == "ntfy" ]]; then
        # tapping a notification opens the auto-eject page
        name="$(tailscale status --json 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"].get("DNSName", "").rstrip("."))' 2>/dev/null || true)"
        if [[ -n "${name}" ]] && tailscale serve status 2>/dev/null | grep -q "${name}"; then
            click="https://${name}/auto-eject/"
        else
            ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
            click="http://${ip:-localhost}/auto-eject/"
        fi
    fi
    backup "${MOONRAKER_CONF}"
    python3 "${tool}" add "${MOONRAKER_CONF}" "${to}" "${click}" "${events}" >/dev/null
    if [[ "${service}" == "ntfy" ]]; then
        log "Added [notifier auto_eject] to moonraker.conf (ntfy topic ${topic})"
        NOTIFY_TOPIC="${topic}"
    else
        log "Added [notifier auto_eject] to moonraker.conf (${service})"
    fi
    restart_moonraker
    local set=0
    if moonraker_gcode "AUTO_EJECT_SET KEY=notify VALUE=auto_eject"; then
        log "Auto-eject now sends its messages to the auto_eject notifier"
        set=1
    else
        warn "Run this in the console once Klipper is up to date (FIRMWARE_RESTART first): AUTO_EJECT_SET KEY=notify VALUE=auto_eject"
    fi
    if ask "Send a test notification now?" y; then
        # the whole way: Klipper, Moonraker's notifier, the service; ntfy alone if Klipper is not ready
        if [[ "${set}" -eq 1 ]] && moonraker_gcode "AUTO_EJECT_NOTIFY_TEST"; then
            log "Test notification sent through Klipper and Moonraker"
        elif [[ "${service}" == "ntfy" ]] && curl -s -m 10 -H "Title: Auto-eject" -H "Tags: white_check_mark" \
            -d "Notifications from your printer work." "https://ntfy.sh/${topic}" >/dev/null; then
            log "Test notification sent straight to ntfy"
        else
            warn "Send a test later: AUTO_EJECT_NOTIFY_TEST in the console, once Klipper is up to date."
        fi
    fi
}

# --------------------------------------------------------------- Spoolman
# Spoolman runs once for all the printers (Home Assistant, a NAS, a Pi...);
# each printer's Moonraker only needs its address.

# Look once for Spoolman on its own port, here and on the local network:
# few people have its address at hand.
find_spoolman() {
    [[ -n "${SPOOLMAN_FOUND}" ]] && return
    log "Looking for Spoolman on your network (a few seconds) ..."
    SPOOLMAN_FOUND="$(python3 "${REPO_DIR}/tools/moonraker_spoolman.py" find 2>/dev/null || true)"
}

install_spoolman() {
    local tool now addr url version line
    tool="${REPO_DIR}/tools/moonraker_spoolman.py"
    log "Spoolman: the queue stops before a job the spool cannot finish, see docs/spoolman.md"
    if [[ ! -f "${MOONRAKER_CONF}" ]]; then
        warn "moonraker.conf not found: add a [spoolman] section by hand (docs/spoolman.md)"
        return
    fi
    now="$(python3 "${tool}" server "${MOONRAKER_CONF}")"
    if [[ -n "${now}" ]] && ask "Moonraker is linked to Spoolman at ${now}. Keep it?" y; then
        return
    fi
    if [[ ! -t 0 ]]; then
        warn "Run install.sh --spoolman from a terminal: it asks where Spoolman runs."
        return
    fi
    find_spoolman
    url="" version=""
    if [[ -n "${SPOOLMAN_FOUND}" ]]; then
        if [[ "$(wc -l <<<"${SPOOLMAN_FOUND}")" -gt 1 ]]; then
            log "Spoolman answers at:"
            while IFS= read -r line; do echo "    ${line}"; done <<<"${SPOOLMAN_FOUND}"
        fi
        if ask "Use Spoolman at ${SPOOLMAN_FOUND%% *}?" y; then
            url="${SPOOLMAN_FOUND%% *}"
            version="$(head -n 1 <<<"${SPOOLMAN_FOUND}" | cut -d' ' -f2)"
        fi
    fi
    if [[ -z "${url}" ]]; then
        read -r -p "$(printf '\033[1;36m[auto-eject]\033[0m %s ' "Spoolman's address, as in your browser (e.g. 192.168.1.50:7912), or Enter to skip:")" addr
        if [[ -z "${addr}" ]]; then
            warn "Skipped. Run install.sh --spoolman when Spoolman is installed."
            return
        fi
        url="$(python3 "${tool}" url "${addr}")"
        if [[ -z "${url}" ]]; then
            warn "That is not an address: ${addr}"
            return
        fi
        version="$(python3 "${tool}" check "${url}")"
    fi
    if [[ -n "${version}" ]]; then
        log "Spoolman ${version} answers at ${url}"
    elif ! ask "Spoolman does not answer at ${url}. Add it anyway?" n; then
        return
    fi
    backup "${MOONRAKER_CONF}"
    case "$(python3 "${tool}" add "${MOONRAKER_CONF}" "${url}")" in
        added) log "Added [spoolman] to moonraker.conf"; restart_moonraker ;;
        changed) log "Moonraker now uses Spoolman at ${url}"; restart_moonraker ;;
        present) log "moonraker.conf already uses Spoolman at ${url}" ;;
        *) warn "Could not change moonraker.conf: add [spoolman] by hand (docs/spoolman.md)"; return ;;
    esac
    log "Now choose the spool on this printer: the Spool card of the print queue, or Mainsail or Fluidd."
    if [[ ! -f "${PUSH_UNIT}" && "${PUSH}" -ne 1 ]]; then
        log "For the queue to stop by itself while the page is closed, also run install.sh --push."
    fi
}

# ------------------------------------------------- notifications in the app
# Moonraker restarts the services listed in moonraker.asvc on request, and
# its update manager restarts this one after an update.
push_moonraker_links() {
    local action="$1" asvc="${CONFIG_DIR%/config}/moonraker.asvc"
    if [[ "${action}" == "add" ]]; then
        [[ -f "${asvc}" ]] && sed -i '/^auto-eject-push$/d' "${asvc}"
        if [[ -f "${asvc}" ]] && ! grep -qx "${PUSH_NAME}" "${asvc}"; then
            echo "${PUSH_NAME}" >> "${asvc}"
        fi
    elif [[ -f "${asvc}" ]]; then
        sed -i "/^${PUSH_NAME}\$/d;/^auto-eject-push\$/d" "${asvc}"
    fi
    [[ -f "${MOONRAKER_CONF}" ]] || return 0
    python3 - "${MOONRAKER_CONF}" "${action}" "${PUSH_NAME}" <<'PY'
import re, sys
path, action, service = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path, encoding="utf-8").read().split("\n")
out, inside = [], False
for line in lines:
    if re.match(r"^\[", line):
        inside = line.strip() == "[update_manager klipper-auto-eject]"
    elif inside and re.match(r"^(is_system_service|managed_services)\s*[:=]", line):
        continue
    out.append(line)
    if inside and line.strip() == "[update_manager klipper-auto-eject]":
        out.append("managed_services: " + service if action == "add" else "is_system_service: False")
open(path, "w", encoding="utf-8").write("\n".join(out))
PY
}

install_push() {
    local py env="${HOME}/klipper-auto-eject-env" name url i
    log "The klipper-auto-eject service: notifications in the app, even while it is closed"
    log "(docs/notifications.md), and the printer farm (docs/farm.md)"
    name="$(tailscale status --json 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"].get("DNSName", "").rstrip("."))' 2>/dev/null || true)"
    if [[ -z "${name}" ]] || ! tailscale serve status 2>/dev/null | grep -q "${name}"; then
        warn "Phones allow notifications only over HTTPS: install.sh --remote sets that up (docs/remote-access.md)."
        [[ "${FARM}" -eq 1 ]] && log "The farm works without it, on your network."
    fi
    if ! ask "Install the klipper-auto-eject service? (asks for your sudo password once)" y; then
        return
    fi
    # the page reaches the service through nginx: an older web page lacks the way
    if [[ -f "${NGINX_SNIPPET}" ]] && ! grep -q "proxy_request_buffering" "${NGINX_SNIPPET}"; then
        install_web
    fi
    if python3 -c "import cryptography" 2>/dev/null; then
        py="$(command -v python3)"
    else
        log "Installing Python's cryptography package in ${env}"
        if ! python3 -m venv "${env}"; then
            warn "python3 -m venv failed. Install it (sudo apt install python3-venv), then run install.sh --push again."
            return
        fi
        if ! "${env}/bin/pip" install --quiet --upgrade pip cryptography; then
            warn "pip could not install cryptography. Check the internet connection, then run install.sh --push again."
            return
        fi
        py="${env}/bin/python"
    fi
    url="http://127.0.0.1:$(moonraker_port)"
    if [[ -f "${OLD_PUSH_UNIT}" ]]; then          # the first version's name
        sudo systemctl disable --now auto-eject-push || true
        sudo rm -f "${OLD_PUSH_UNIT}"
    fi
    sudo tee "${PUSH_UNIT}" >/dev/null <<EOF
# klipper-auto-eject, added by install.sh --push or --farm
# (docs/notifications.md, docs/farm.md)
[Unit]
Description=klipper-auto-eject: notifications in the web page (Web Push) and the printer farm
After=network-online.target moonraker.service
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
ExecStart=${py} ${REPO_DIR}/push/auto_eject_push.py --moonraker ${url}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable "${PUSH_NAME}"
    sudo systemctl restart "${PUSH_NAME}"
    push_moonraker_links add
    restart_moonraker
    for i in $(seq 1 20); do
        if curl -s -m 3 "${url}/server/database/item?namespace=auto_eject_push&key=vapid" | grep -q '"value"'; then
            log "The klipper-auto-eject service is running"
            if [[ "${FARM}" -eq 1 ]]; then
                log "Now open the Printer farm tab of the web page and press Search the network"
            fi
            log "Notifications: in the auto-eject app on your phone, Blade and setup, Notifications, Turn on"
            return
        fi
        sleep 1
    done
    warn "The service did not start. See: journalctl -u ${PUSH_NAME} -n 30"
    : "${i}"
}

uninstall_push() {
    local unit
    for unit in "${PUSH_UNIT}" "${OLD_PUSH_UNIT}"; do
        if [[ -f "${unit}" ]]; then
            sudo systemctl disable --now "$(basename "${unit}" .service)" || true
            sudo rm -f "${unit}"
            sudo systemctl daemon-reload
            log "Removed the notification service"
        fi
    done
    push_moonraker_links remove
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
# relative redirects keep https:// behind an HTTPS proxy such as tailscale serve
location = /auto-eject { absolute_redirect off; return 302 /auto-eject/web/; }
location = /auto-eject/ { absolute_redirect off; return 302 /auto-eject/web/; }
location ~ ^/auto-eject/(.*/)?\. { deny all; }
location /auto-eject/ {
    alias ${REPO_DIR}/;
    index index.html;
    add_header Cache-Control "no-cache";
}
# the klipper-auto-eject service: the printer farm (install.sh --farm or --push)
location ^~ /auto-eject/api/ {
    proxy_pass http://127.0.0.1:7128/;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_read_timeout 600s;
    # G-code files sent to the farm's printers
    client_max_body_size 0;
    proxy_request_buffering off;
}
EOF
    local site
    while IFS= read -r site; do
        if sudo grep -q "include ${NGINX_SNIPPET};" "${site}"; then
            log "${site} already includes the web page (updated)"
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
    if [[ -f "${PUSH_UNIT}" || -f "${OLD_PUSH_UNIT}" ]]; then
        uninstall_push
    fi
    navi_entry remove
    setup_demon remove || true
    if [[ -f "${MOONRAKER_CONF}" ]] && command -v python3 >/dev/null && [[ -f "${REPO_DIR}/tools/moonraker_trust.py" ]] \
        && [[ "$(python3 "${REPO_DIR}/tools/moonraker_trust.py" remove "${MOONRAKER_CONF}" "${TAILNET}")" == "removed" ]]; then
        log "Removed ${TAILNET} from Moonraker's trusted_clients (restart Moonraker to apply it)"
        log "Tailscale itself was left installed. To stop serving HTTPS: sudo tailscale serve --https=443 off"
    fi
    if [[ -f "${MOONRAKER_CONF}" ]] && command -v python3 >/dev/null && [[ -f "${REPO_DIR}/tools/moonraker_notifier.py" ]] \
        && [[ "$(python3 "${REPO_DIR}/tools/moonraker_notifier.py" remove "${MOONRAKER_CONF}")" == "removed" ]]; then
        log "Removed the [notifier auto_eject] sections from moonraker.conf (restart Moonraker to apply it)"
    fi
    if [[ -f "${MOONRAKER_CONF}" ]] && grep -q '^\[spoolman\]' "${MOONRAKER_CONF}"; then
        log "Kept [spoolman] in moonraker.conf: Mainsail and Fluidd use it too."
    fi
    log "Kept ${CONFIG_DIR}/auto_eject_settings.cfg and ${REPO_DIR} (delete them by hand if you want)."
    if [[ -d "${HOME}/.cache/klipper-auto-eject/queue" ]]; then
        log "Kept the farm queue's files in ${HOME}/.cache/klipper-auto-eject/queue (delete them by hand if you want)."
    fi
    log "Restart Klipper to finish: FIRMWARE_RESTART"
    exit 0
fi

# ------------------------------------------------------------- questions
# --demon: only DEMON's hook, on a printer that has auto-eject already
if [[ "${DEMON_ONLY}" -eq 1 ]]; then
    [[ -f "${REPO_DIR}/tools/demon_hook.py" ]] || die "No klipper-auto-eject in ${REPO_DIR}: install it first"
    if ! setup_demon add; then
        log "No DEMON Klipper Essentials in ${CONFIG_DIR}/Demon_User_Files: nothing to do."
    elif [[ "${CHANGED_CFG}" -eq 1 ]] && { [[ ! -t 0 ]] || ask "Restart Klipper now so it loads it? (only if it is not printing)" y; }; then
        restart_klipper
        [[ "${RESTARTED}" -eq 1 ]] || log "Then restart Klipper: type FIRMWARE_RESTART in the Mainsail console."
    elif [[ "${CHANGED_CFG}" -eq 1 ]]; then
        log "Restart Klipper to use it: type FIRMWARE_RESTART in the Mainsail console."
    fi
    exit 0
fi

# --firmware: only the boards' firmware, brought to Klipper's version
if [[ "${FIRMWARE}" -eq 1 ]]; then
    [[ -f "${REPO_DIR}/tools/firmware.py" ]] || die "No klipper-auto-eject in ${REPO_DIR}: install it first"
    command -v python3 >/dev/null || die "python3 is not installed"
    exec python3 "${REPO_DIR}/tools/firmware.py" --moonraker "http://127.0.0.1:$(moonraker_port)" update
fi

# Run with no options from a terminal: ask what to set up, in plain words,
# on one screen of tick boxes, or one question at a time.
if [[ -t 0 && $((WEB + REMOTE + NOTIFY + PUSH + FARM + SPOOLMAN)) -eq 0 ]]; then
    find_spoolman
    if [[ ! -t 1 ]] || ! pick_with_menu; then
        printf '\n  \033[1mklipper-auto-eject\033[0m: a few questions first. Press Enter to keep the answer in capitals.\n\n'
        if [[ "${ADD_INCLUDE}" -eq 1 ]] && ! ask "Will this printer push its prints off with the blade? (No: only the web page or the farm)" y; then
            ADD_INCLUDE=0
        fi
        ask "Add the auto-eject page to Mainsail (bed map, print queue, settings)?" y && WEB=1
        ask "Watch and control the printer from your phone, from anywhere? (a free Tailscale account)" n && REMOTE=1
        if [[ "${REMOTE}" -eq 1 ]]; then
            ask "Notifications on your phone when the printer needs you?" y && PUSH=1
        fi
        if [[ "${WEB}" -eq 1 ]]; then
            ask "More than one Klipper printer? See them all on one page (printer farm)?" n && { FARM=1; PUSH=1; }
        fi
        if [[ "${PUSH}" -eq 0 ]]; then
            ask "Messages on Telegram, Discord or the ntfy app when the printer needs you?" n && NOTIFY=1
        fi
        if [[ -n "${SPOOLMAN_FOUND}" ]]; then
            ask "Spoolman answers at ${SPOOLMAN_FOUND%% *}. Use it, so the queue stops before a spool runs out?" y && SPOOLMAN=1
        else
            ask "Do you use Spoolman, which knows what is left on each spool? (the queue stops before a spool runs out)" n && SPOOLMAN=1
        fi
    fi
    picked="macros"
    [[ "${ADD_INCLUDE}" -eq 1 ]] || picked="no macros"
    [[ "${WEB}" -eq 1 ]] && picked+=", web page"
    [[ "${REMOTE}" -eq 1 ]] && picked+=", phone access"
    [[ "${PUSH}" -eq 1 && "${FARM}" -eq 0 ]] && picked+=", notifications"
    [[ "${FARM}" -eq 1 ]] && picked+=", printer farm and notifications"
    [[ "${NOTIFY}" -eq 1 ]] && picked+=", messages"
    [[ "${SPOOLMAN}" -eq 1 ]] && picked+=", Spoolman"
    printf '\n'
    log "Setting up: ${picked}"
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
    log "Created ${CONFIG_DIR}/auto_eject_settings.cfg, your own settings (the guided setup fills them in)"
fi

# ---------------------------------------------------------- printer.cfg
if [[ "${ADD_INCLUDE}" -eq 1 ]]; then
    [[ -f "${PRINTER_CFG}" ]] || die "printer.cfg not found in ${CONFIG_DIR}"
    if grep -q '^\[include auto_eject\.cfg\]' "${PRINTER_CFG}"; then
        log "printer.cfg already includes auto_eject.cfg"
    else
        backup "${PRINTER_CFG}"
        insert_includes $'[include auto_eject.cfg]\n[include auto_eject_settings.cfg]'
        CHANGED_CFG=1
        log "Added [include] lines to printer.cfg, line ${INCLUDE_LINE}, ${INCLUDE_WHERE}"
    fi
    add_required_sections
    setup_demon add || true
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

NOTIFY_TOPIC=""
if [[ "${NOTIFY}" -eq 1 ]]; then
    install_notify
fi

if [[ "${SPOOLMAN}" -eq 1 ]]; then
    install_spoolman
fi

if [[ "${PUSH}" -eq 1 ]]; then
    install_push
fi

if [[ "${CHANGED_CFG}" -eq 1 && -t 0 ]] && ask "Restart Klipper now so it loads auto-eject? (only if it is not printing)" y; then
    restart_klipper
fi

echo
log "Installed."
if [[ "${ADD_INCLUDE}" -eq 1 ]]; then
    n=1
    echo "  Next:"
    if [[ "${CHANGED_CFG}" -eq 1 && "${RESTARTED}" -eq 0 ]]; then
        echo "    ${n}. Restart Klipper: type FIRMWARE_RESTART in the Mainsail console."; n=$((n + 1))
    fi
    echo "    ${n}. Mount the blade, then type AUTO_EJECT_SETUP in the console: it guides"
    echo "       you through every setting with buttons (docs/setup-wizard.md)."; n=$((n + 1))
    echo "    ${n}. In your slicer, end the end G-code with:  AUTO_EJECT HEIGHT=[max_layer_z] HOME=1"
    echo "       (docs/slicer-setup.md)"; n=$((n + 1))
    echo "    ${n}. Read docs/safety.md before leaving it alone."
    echo
fi
if [[ "${WEB}" -eq 1 || -f "${NGINX_SNIPPET}" ]]; then
    echo "  The web page: http://$(hostname -I 2>/dev/null | awk '{print $1}')/auto-eject/"
else
    echo "  Optional: a web page with the bed map, the queue and the settings:"
    echo "    ${REPO_DIR}/install.sh --web      (docs/web-page.md)"
fi
if [[ -n "${REMOTE_URL}" ]]; then
    echo "  From your phone (with the Tailscale app on): ${REMOTE_URL}/"
    echo "  The auto-eject page:                          ${REMOTE_URL}/auto-eject/"
elif grep -qs "klipper-auto-eject: remote access" "${MOONRAKER_CONF}"; then
    echo "  Remote access is set up (docs/remote-access.md)."
else
    echo "  Optional: watch and control it from your phone, from anywhere:"
    echo "    ${REPO_DIR}/install.sh --remote   (docs/remote-access.md)"
fi
if [[ -f "${PUSH_UNIT}" && -f "${NGINX_SNIPPET}" ]]; then
    echo "  All your printers: http://$(hostname -I 2>/dev/null | awk '{print $1}')/auto-eject/web/#/farm"
else
    echo "  Optional: all your printers on one page (a printer farm):"
    echo "    ${REPO_DIR}/install.sh --farm     (docs/farm.md)"
fi
if [[ -f "${PUSH_UNIT}" ]]; then
    echo "  Notifications in the app: turn them on in the app, Blade and setup tab."
else
    echo "  Optional: notifications in the app, even while it is closed:"
    echo "    ${REPO_DIR}/install.sh --push     (docs/notifications.md)"
fi
if [[ -z "${NOTIFY_TOPIC}" ]] && [[ -f "${MOONRAKER_CONF}" ]] && command -v python3 >/dev/null; then
    NOTIFY_TOPIC="$(python3 "${REPO_DIR}/tools/moonraker_notifier.py" topic "${MOONRAKER_CONF}" 2>/dev/null || true)"
fi
SPOOLMAN_URL=""
if [[ -f "${MOONRAKER_CONF}" ]] && command -v python3 >/dev/null; then
    SPOOLMAN_URL="$(python3 "${REPO_DIR}/tools/moonraker_spoolman.py" server "${MOONRAKER_CONF}" 2>/dev/null || true)"
fi
if [[ -n "${SPOOLMAN_URL}" ]]; then
    echo "  Spoolman: ${SPOOLMAN_URL} (the queue is checked against the spool, docs/spoolman.md)"
else
    echo "  Optional: with Spoolman, the queue stops before a spool runs out:"
    echo "    ${REPO_DIR}/install.sh --spoolman (docs/spoolman.md)"
fi
FIRMWARE_BEHIND=""
if command -v python3 >/dev/null; then
    FIRMWARE_BEHIND="$(python3 "${REPO_DIR}/tools/firmware.py" --moonraker "http://127.0.0.1:$(moonraker_port)" behind 2>/dev/null || true)"
fi
if [[ -n "${FIRMWARE_BEHIND}" ]]; then
    echo "  Optional: these boards run older firmware than Klipper (${FIRMWARE_BEHIND}):"
    echo "    ${REPO_DIR}/install.sh --firmware (docs/firmware.md)"
fi
NOTIFY_KIND=""
if [[ -f "${MOONRAKER_CONF}" ]] && command -v python3 >/dev/null; then
    NOTIFY_KIND="$(python3 "${REPO_DIR}/tools/moonraker_notifier.py" kind "${MOONRAKER_CONF}" 2>/dev/null || true)"
fi
if [[ "${NOTIFY_KIND}" == "telegram" || "${NOTIFY_KIND}" == "discord" ]]; then
    echo "  Notifications: on ${NOTIFY_KIND^} (docs/notifications.md)"
fi
if [[ -n "${NOTIFY_TOPIC}" ]]; then
    echo "  Notifications: install the ntfy app (Google Play, F-Droid or the App Store),"
    echo "  tap +, and subscribe to this topic on ntfy.sh: ${NOTIFY_TOPIC}"
    echo "  (or open https://ntfy.sh/${NOTIFY_TOPIC} in a browser). Keep the topic to yourself."
fi
echo
