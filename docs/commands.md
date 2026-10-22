[klipper-auto-eject](../README.md) › [Documentation](README.md) › Commands

# Commands

Type these in the Mainsail or Fluidd console, or put them in your slicer's G-code. Run the ones
that move the printer only when it is not printing, except `AUTO_EJECT` in the end G-code.

## Everyday

| Command | What it does |
|---|---|
| `AUTO_EJECT` | Cool the bed, push the parts off, check the bed with the probe. Put it in the slicer's end G-code |
| `AUTO_EJECT HEIGHT=[max_layer_z]` | The same, with the print height from the slicer, so flat prints are recognised and left alone |
| `AUTO_EJECT HOME=1` | Home safely around the parts first if the printer is not homed (after the end macro turned the motors off, a restart or a power cut), then eject |
| `AUTO_EJECT DRY=1` | Trace the path 2 cm above the bed without pushing, cooling or probing |
| `AUTO_EJECT_CLEAR` | You took the parts off by hand: forget them, the bed is clear. While the bed cools with the printer free, it also stops the eject and lets the job queue go on |
| `AUTO_EJECT_PUSH_NOW` | While the bed cools with the printer free (`cool_background`), push the parts off now instead of waiting ([how](configuration.md#cooling-with-the-printer-free)) |
| `AUTO_EJECT_BIN_EMPTY` | You emptied the parts box: count from zero again ([the parts box](configuration.md#the-parts-box)) |
| `AUTO_EJECT_NOTIFY_TEST` | Send a test notification to your phone, through the app's notification service and the `notify` notifier, whichever are set up ([notifications.md](notifications.md)) |
| `AUTO_EJECT_CONTINUE` | You took flat prints off by hand: close the dialog and start the job queue again |

## Setup

| Command | What it does |
|---|---|
| `AUTO_EJECT_SETUP` | The guided setup, in dialogs ([setup-wizard.md](setup-wizard.md)) |
| `AUTO_EJECT_CALIBRATE` | Measure the blade again with a nozzle probe (Voron Tap), for example after moving it |
| `AUTO_EJECT_SET KEY=cool_temp VALUE=35` | Change one setting and keep it after a restart ([configuration.md](configuration.md)) |
| `AUTO_EJECT_SET KEY=cool_temp RESET=1` | Go back to the value in `auto_eject_settings.cfg` |
| `AUTO_EJECT_SETUP STEP=reset` | Forget every value saved by the setup and `AUTO_EJECT_SET` |

## In the slicer's start G-code

| Command | What it does |
|---|---|
| `AUTO_EJECT_GUARD` | First line: stops the print if parts from an earlier print may still be on the bed ([recovery.md](recovery.md)) |
| `EJECT_PURGE` | After your start macro: purge a tall blob the blade can push off, instead of a thin line ([integration.md](integration.md#eject_purge-instead-of-a-purge-line)) |
| `EJECT_PURGE X=200 Y=60` | The same, at a fixed spot |

## Options for one run

These can be combined, for example `AUTO_EJECT HOME=1 COOL=0`.

| Option | What it does |
|---|---|
| `STRATEGY=columns`, `objects` or `full_width` | Use another path strategy this time ([strategies.md](strategies.md)) |
| `COOL=0` | Do not wait for the bed to cool |
| `VERIFY=0` | Do not check the bed with the probe afterwards |
| `SOURCE=saved` | Eject the parts remembered from before a restart (used with `HOME=1`) |
| `HEIGHT=12.4` | The print's height in mm |
