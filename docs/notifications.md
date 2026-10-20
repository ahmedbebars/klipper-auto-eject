[klipper-auto-eject](../README.md) › [Documentation](README.md) › Notifications

# Notifications

A message on your phone when the printer needs you, and, if you like, when every print is done.

| You get a notification when… | |
|---|---|
| a part is still on the bed after the eject and its retries | the job queue stopped |
| a print is too thin for the blade and was left on the bed | the job queue waits for you |
| a print ended without an eject (no `AUTO_EJECT` in the end G-code, or cancelled) | the parts are still on the bed |
| the next print did not start because old parts are still on the bed | [the guard](recovery.md#the-guard-auto_eject_guard) |
| the parts box is almost full, or full ([`bin_capacity`](configuration.md#the-parts-box)) | when full, the next print waits until you empty it |
| a print stopped with an error, or was cancelled | |
| a printer's maintenance is due, and the farm's daily report ([farm.md](farm.md#maintenance-reminders-and-the-daily-report)) | in the app, with the farm |
| every print finishes (optional) | with `AUTO_EJECT` in the end G-code this comes once the bed is clear |

Tapping a notification opens the auto-eject page. With a [printer farm](farm.md), the app also
gets them from every other printer of the farm, each with its name.

There are two ways to get them:

| | [In the auto-eject app](#in-the-auto-eject-app-recommended) | [With ntfy](#with-ntfy) |
|---|---|---|
| Another app on the phone | No: the notifications come from the auto-eject app | The free ntfy app |
| While the app is closed | Yes | Yes |
| Needs | HTTPS ([remote-access.md](remote-access.md#https)), `sudo` once | Nothing else |
| Who can read the messages | Only your devices: encrypted end to end | Anyone who knows the topic name |
| Telegram, Discord, email… | No | Yes, through Apprise |

## In the auto-eject app (recommended)

A small service on the printer watches it and sends each notification, encrypted, to the push
service of every device that turned them on: Google's for Chrome and Android, Apple's for
iPhone and iPad, Mozilla's for Firefox. It works while the app is closed, and even while the
phone's Tailscale is off: only opening the app needs Tailscale.

1. Set up [remote access with HTTPS](remote-access.md) first: phones allow notifications only
   over HTTPS.
2. **On the printer**, over SSH:
   ```bash
   ~/klipper-auto-eject/install.sh --push
   ```
   It installs the `klipper-auto-eject` service (Python's `cryptography` package goes into
   `~/klipper-auto-eject-env` if it is missing) and lets Moonraker restart it after updates. It
   asks for your password once.
3. **On the phone**, open the auto-eject app over HTTPS, **Blade and setup** tab,
   **Notifications**, **Turn on**, and allow notifications. A test notification arrives.
4. Do the same on every phone, tablet or computer that should get them. Each one chooses
   whether it also wants a notification when every print finishes.

| Device | Works |
|---|---|
| Android: Chrome, Edge, Samsung Internet, Firefox | Yes, installed as an app or not |
| iPhone and iPad | iOS 16.4 or newer, and only in the app [added to the Home Screen](web-page.md#on-your-phone-as-an-app) |
| Computers: Chrome, Edge, Firefox, Safari | Yes, while the browser runs |

How it works: the device subscribes with its browser and stores the subscription in Moonraker's
database (namespace `auto_eject_push`), so the service needs no port of its own. Each message is
encrypted for that one device ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291)); the push
services carry it without being able to read it. The service's own key stays in
`~/.config/klipper-auto-eject/vapid.pem`. Its log: `journalctl -u klipper-auto-eject`.

## With ntfy

The notifications go through [ntfy](https://ntfy.sh), a free, open-source notification app.

1. **On the printer**, over SSH:
   ```bash
   ~/klipper-auto-eject/install.sh --notify
   ```
   It asks before every step:
   - whether to send notifications with ntfy,
   - whether you also want one when every print finishes,
   - and, at the end, whether to send a test notification.

   It adds two `[notifier]` sections to `moonraker.conf` (after a backup), restarts Moonraker when
   the printer is idle, and sets the auto-eject setting `notify` to `auto_eject`. At the end it
   shows your **topic**, a random name like `auto-eject-3f9a1c2b7d4e5f60`.
2. **On your phone**, install the ntfy app (Google Play, F-Droid or the App Store), tap **+** and
   subscribe to that topic on the default server, `ntfy.sh`.
3. Run the installer again any time: it keeps the same topic.

**It worked if** the test notification arrives on the phone. Send another one any time with
`AUTO_EJECT_NOTIFY_TEST` in the console, or **Send a test** on the page: it goes the whole way,
from Klipper through Moonraker to the phone, by both ways that are set up.

The auto-eject page shows the topic on its **Blade and setup** tab, with a button that opens it
in ntfy.

## Keep the topic to yourself

On the public `ntfy.sh` server, anyone who knows a topic's name can read its messages. The
installer picks a random name that nobody can guess; don't post it anywhere. The messages hold
file names and part names, nothing else.

To keep everything on your own network, [run your own ntfy server](https://docs.ntfy.sh/install/)
and change the `url:` lines in `moonraker.conf`:

```ini
url: ntfys://user:password@ntfy.example.com/auto-eject-3f9a1c2b7d4e5f60?priority=high&tags=warning
```

## Telegram, Discord, email and others

Moonraker sends notifications with [Apprise](https://github.com/caronc/apprise/wiki), which knows
about 100 services. Put any Apprise URL in the `url:` of the two sections, for example
`tgram://<bot-token>/<chat-id>` for Telegram, and restart Moonraker.

## By hand, without the installer

```ini
# moonraker.conf
[notifier auto_eject]
url: ntfys://<your-topic>?priority=high&tags=warning
events: gcode
title: Auto-eject
body: {event_message}

[notifier auto_eject_jobs]
url: ntfys://<your-topic>?tags=printer
events: complete, error, cancelled
title: Print {event_name}
body: {event_args[1].filename}{(': ' ~ event_args[1].message) if event_args[1].message else ''}
```

Restart Moonraker, then tell auto-eject which notifier to use, in the console:

```gcode
AUTO_EJECT_SET KEY=notify VALUE=auto_eject
```

`[notifier auto_eject]` gets the auto-eject messages (`events: gcode`); `[notifier
auto_eject_jobs]` gets Moonraker's own events for whole prints. Leave the second one out if you
only want to hear about problems.

## Without the service

Without `install.sh --push`, **Turn on** still works while the auto-eject app is open or in the
background: the page shows the notifications itself. When the app is closed, only the service
or ntfy can reach you.

## Mobileraker

[Mobileraker](https://mobileraker.app) has its own notifications for prints and errors when its
companion is installed on the printer ([remote-access.md](remote-access.md#phone-apps-and-the-camera)).
It works next to ntfy.

## Problems

| What you see | What to do |
|---|---|
| No **Turn on** button in the app | The page is not on HTTPS ([remote-access.md](remote-access.md#https)), or notifications are blocked for it in the browser's site settings |
| The app says notifications are on only while it runs | The service is not installed or not running: `install.sh --push`, then `systemctl status klipper-auto-eject` |
| Nothing arrives on an iPhone | Add the app to the Home Screen and turn notifications on from there (iOS 16.4 or newer) |
| The test notification does not arrive | In the ntfy app, check the topic and the server (`ntfy.sh`). On the printer, `curl -d test https://ntfy.sh/<topic>` should reach the phone |
| Test works, but nothing from the printer | Moonraker was not restarted after the change, or `notify` is not set: `AUTO_EJECT_SET KEY=notify VALUE=auto_eject` |
| `Remote method 'notify' not registered` | `notify` names a notifier that Moonraker does not have. Check the section names in `moonraker.conf`, or set `notify` back to `""` |
| Too many notifications | Run `install.sh --notify` again and answer no to a notification for every print |
