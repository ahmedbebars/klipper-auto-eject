[klipper-auto-eject](../README.md) › [Documentation](README.md) › Web page

# Web page

An **Auto-eject** page for the printer's web interface: what the printer is doing, a map of the
bed with the push lanes, the print queue, a check for G-code files, the blade setup and every
setting. In Mainsail it gets its own entry in the sidebar.

<p align="center"><img src="images/web-page.png" alt="The Auto-eject page while the printer clears the bed" width="900"></p>

It is optional. Everything it does can also be done from the console, and it never does
anything the console could not: every button runs one of the commands from the
[command list](commands.md) or a Moonraker job queue call.

**Try it without a printer:** open `web/index.html?demo` from a local web server (see
[Trying it on a computer](#trying-it-on-a-computer)). The demo printer prints, cools, clears the
bed and starts the next job by itself.

## What is on it

| Section | What it does |
|---|---|
| **Overview** | Status (ready, printing, cooling, clearing the bed, needs you) with progress. The bed map shows the stored parts, the lanes the blade will push along, the drop edge and the toolhead moving live. Buttons: **Eject now** (or **Home safely and eject** after a restart), **Dry run**, **I took the parts off** and, when the queue is paused, **Bed is clear, continue the queue**. Every button that moves the printer asks first. A camera is shown if one is set up in Moonraker. |
| **Print queue** | Shown when Moonraker has a `[job_queue]`. Add files (with a number of copies), remove them, start or pause the queue. Each file says whether it will be pushed off or is too thin and stays on the bed. Says whether the queue moves on by itself (`automatic_transition`). |
| **Check a file** | Pick a G-code file and the page reads it: are the parts labelled, does the end G-code run `AUTO_EJECT`, is the print tall enough, can the blade get behind every part? It draws the plan on the bed map before you print. |
| **Blade and setup** | The measured blade (height above the nozzle tip, distance ahead of it, width) in a side view, the probe type, buttons for the guided setup, the blade measurement and a dry run, and downloads for the test parts (calibration block, blade gauge, test cube). The setup dialogs open right in the page. |
| **Settings** | Every setting from `auto_eject_settings.cfg`, grouped like the file, with its explanation, a switch, a list or a number box, and where the value comes from (default, your file, or saved here). Changes are saved with `AUTO_EJECT_SET` and kept after a restart. |
| **Activity** | The auto-eject messages from the console, newest first. |
| **How it works** | The illustrated guide. |

The page is in English and Arabic (right to left), in light and dark, and works on a phone.
It picks the browser's language and theme; both can be switched at the top.

## Installing

```bash
~/klipper-auto-eject/install.sh --web
```

This needs `sudo` once (it asks for your password), because the page is served by nginx, the
same web server as Mainsail or Fluidd. The script:

1. Writes `/etc/nginx/auto-eject.conf`, which serves the page from the repository at
   `http://<printer>/auto-eject/`.
2. Adds one `include` line for it to the Mainsail or Fluidd site in `/etc/nginx/sites-enabled/`
   (a backup goes to `/etc/nginx/`), checks the result with `nginx -t` and reloads nginx.
   If nginx does not accept it, the old file is put back.
3. Adds an **Auto-eject** link to the Mainsail sidebar in `.theme/navi.json` in your config
   folder. Reload Mainsail to see it.

The page lives in the repository, so the Moonraker update manager updates it together with the
macros. Reloading nginx does not interrupt a print. `install.sh --uninstall` removes all three.

**Fluidd** has no custom sidebar links: bookmark `http://<printer>/auto-eject/`.

### By hand

Add this inside the `server { ... }` block of your Mainsail or Fluidd site
(`/etc/nginx/sites-available/mainsail` on most installs), with your own path:

```nginx
location = /auto-eject/ { return 302 /auto-eject/web/; }
location ~ ^/auto-eject/(.*/)?\. { deny all; }
location /auto-eject/ {
    alias /home/pi/klipper-auto-eject/;
    index index.html;
    add_header Cache-Control "no-cache";
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`. For the Mainsail sidebar, create
`.theme/navi.json` in your config folder (or add the entry to the one you have):

```json
[
  {
    "title": "Auto-eject",
    "href": "/auto-eject/web/",
    "target": "_self",
    "position": 35,
    "icon": "M2 11h12V7l6 5-6 5v-4H2z M20 4h2v16h-2z"
  }
]
```

## Requirements

- klipper-auto-eject installed and included in `printer.cfg` (the page says so if the macros
  are missing).
- Moonraker, reachable through the same nginx (the usual Mainsail/Fluidd install).
- The browser must be allowed in by Moonraker, as for Mainsail: its network in
  `trusted_clients` in `moonraker.conf`. The page does not log in.
- `[save_variables]` in `printer.cfg`, to keep changed settings after a restart. Without it they
  last until the next restart, and the page says so.
- Optional: `[job_queue]` in `moonraker.conf` for the queue section, a webcam in Moonraker for
  the camera picture.

Nothing is loaded from the internet: the page is plain HTML, CSS and JavaScript, and works on a
printer with no internet access.

## Changing a setting from the console

The page saves settings with a macro you can also use yourself:

```
AUTO_EJECT_SET KEY=cool_temp VALUE=35
AUTO_EJECT_SET KEY=verify VALUE=off
AUTO_EJECT_SET KEY=cool_temp RESET=1
```

The value is checked against the setting's type (a number for numbers, on/off for switches) and
saved in `[save_variables]`, like the guided setup's values. It takes the place of the value in
`auto_eject_settings.cfg` until you reset it. Text values cannot contain spaces, quotes, `#` or
`;`; edit the file for those.

## Trying it on a computer

From a checkout of the repository:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/web/?demo`. Useful additions to the address:

| | |
|---|---|
| `?demo=eject` | The demo starts clearing the bed by itself |
| `&lang=ar`, `&lang=en` | Language |
| `&theme=dark`, `&theme=light` | Theme |
| `?printer=http://printer.local:7125` | Talk to a real printer from the computer. Its `moonraker.conf` needs the computer's address in `cors_domains`. |

## Translating

The texts are in `web/lang/`. Copy `en.js` to a new file named after the language code,
translate the values (keep the `{placeholders}`), change the first line to your code, language
name and direction (`"ltr"` or `"rtl"`), and add a `<script>` line for it in `web/index.html`.
Anything left out is shown in English. Setting names and console messages stay in English.

## How it is built

| File | |
|---|---|
| `web/index.html` | The page |
| `web/app.js` | Views, buttons and the Moonraker connection |
| `web/model.js` | The logic: the push plan, reading the settings file, checking G-code, the setup dialogs. It does what the macros do, and `tests/test_web.py` compares the two |
| `web/moonraker.js` | A small Moonraker websocket client |
| `web/demo.js` | The pretend printer for `?demo` |
| `web/style.css` | Styles, light and dark |

The settings section is built from the comments in `config/auto_eject_settings.cfg`, so a new
setting shows up in the page with its explanation without changing the page.
