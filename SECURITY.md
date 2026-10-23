# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately on GitHub:
**[Report a vulnerability](https://github.com/ahmedbebars/klipper-auto-eject/security/advisories/new)**
(the **Security** tab of the repository).

Say what is affected, how to reproduce it, and which version you run (the page's **Updates** tab,
or `git -C ~/klipper-auto-eject describe --tags`). The answer comes on the report itself. Once a
fix is released, the report is made public, with your name if you want it there.

## Supported versions

Only the latest release gets security fixes. Update through Mainsail or Fluidd's update manager,
or the page's **Updates** tab.

| Version | Fixes |
|---|---|
| 0.17.x | Yes |
| Older | No: update |

## What it runs, and who can reach it

| Part | Runs as | Reachable from |
|---|---|---|
| The macros (`config/`) | Inside Klipper | Nothing: no network of their own |
| The web page (`web/`) | Static files that your nginx serves at `/auto-eject/` | Wherever Mainsail or Fluidd can be opened. The page talks to Moonraker from your browser, the way Mainsail does, with Moonraker's own login if you set one up. Its files all come from the printer; only the **Updates** tab asks GitHub, from your browser, what an update changes |
| The service (`push/`): notifications and the farm | Your user, as a systemd service | Its farm API listens on `127.0.0.1:7128` only. nginx publishes it at `/auto-eject/api/`, and it answers private networks only: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` and Tailscale's `100.64.0.0/10` |
| `install.sh` | Your user | It asks for `sudo` only to add the nginx file (after a backup of your site file), to add the systemd service, and, with `--remote`, to set up Tailscale |

Notifications are encrypted for each phone or computer ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291)),
so the push services cannot read them. The service signs them with its own key, kept in
`~/.config/klipper-auto-eject/vapid.pem`, which only your user can read.

## Keep the printer off the public internet

Like Moonraker, auto-eject trusts the network it is on: anyone who can open the page can press
its buttons, as in Mainsail. Do not forward a port to the printer, and do not publish it with
`tailscale funnel`. To reach it from away, use Tailscale as in
[remote access](docs/remote-access.md): only your own devices get in.

## Not covered here

- Klipper, Moonraker, Mainsail, Fluidd, nginx, Tailscale and ntfy: report to those projects.
- The machine's physical safety (heat, motion, the blade): see [safety](docs/safety.md), and open
  a normal issue for a problem there.
