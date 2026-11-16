# USB clicker remotes

Status: **experimental user-level configuration**. **Menu → Experimental → Clicker** captures a USB
presentation remote, maps its buttons to live-control actions and saves the mapping to the signed-in
user's account. A live-page enable toggle is planned once this workflow is verified with real hardware.

## What works in a browser

Most USB presentation remotes, including the **Logitech R400 (USB `046d:c538`)**, identify
themselves to the operating system as **HID keyboards**. They send ordinary key events:

| R400 button | Key |
| --- | --- |
| Previous | `PageUp` |
| Next | `PageDown` |
| Slideshow start/stop | `F5` / `Escape` |
| Black screen | `.` (`Period`) |

Browsers deliberately block WebHID/WebUSB access to HID collections that the operating system
treats as keyboards, to prevent keylogging. Service Maestro therefore offers two paths:

1. **Keyboard capture (recommended):** focus the Clicker page, choose **Capture button**, and press
   the remote button. The page records the browser key/code, and the same key can be mapped to a
   live action.
2. **Browser HID access (optional):** the **Try browser HID access** button opens the browser HID
   chooser for `046d:c538`. This may be refused or the device may be hidden because it is a
   keyboard-class HID device.

While the Clicker page is open, **Enable clicker on this page for testing** listens for mapped keys
and sends the selected live command, so the mapping can be verified without enabling it elsewhere.
This test mode is only active on the Clicker page.

## Actions

- Next / previous page or item
- Next / previous page only
- Next / previous set-list item
- Hide / show (blank)
- Transpose up / down
- More / fewer lines per page
- No action

The R400 defaults map `PageDown` to **Next page or item**, `PageUp` to **Previous page or item** and
`Period` to **Hide / show**.

## Persistence and permissions

- Mappings are stored per user in `user_preferences` under the `clicker` key.
- Any signed-in user can configure their own clicker.
- Sending test actions still requires write permission for live control.
- The Clicker menu item is in the burger/Menu dropdown, not the primary navigation.

## Limitations

- A browser cannot identify which physical keyboard sent a key event. While test mode is listening,
  a normal keyboard pressing the same mapped key would also trigger the action. The future live-page
  toggle should therefore only be enabled when the clicker is the intended controller.
- Browser fullscreen or OS-level keyboard capture may affect key delivery. Escape can leave
  fullscreen regardless of mapping.
- HID report mapping for non-keyboard devices is not implemented yet; keyboard capture is the
  supported path for the R400.
