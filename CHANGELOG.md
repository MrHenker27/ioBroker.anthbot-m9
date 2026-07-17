## 0.2.19 (2026-07-17)

- RTK skyplot is now rendered directly from `diagnostics.admin.skyplotHtml` using the supported JSONConfig `state` component with `control: html`.
- Removed the non-triggering `textSendTo` path from the Admin layout.
- Added unit tests that decode the embedded SVG and verify a visible satellite map and empty-state map.

## 0.2.18 (2026-07-17)

- Fix Admin JSONConfig validation for the RTK skyplot by removing unsupported `doNotSave` from `textSendTo`.
- The skyplot component can now be instantiated so its adapter command is actually requested.

## 0.2.17 (2026-07-17)

- Replaced the unreliable `imageSendTo` sky plot with a schema-safe `textSendTo` HTML component.
- Return a real inline PNG image inside HTML so the satellite map is visible in ioBroker Admin 7.8.x.
- Added explicit request, success and failure logging for the Admin sky plot command.
- Show a visible error box instead of an empty area if rendering fails.

## 0.2.16 (2026-07-17)

- Render the RTK sky plot as PNG before returning it to ioBroker Admin. Admin 7.8.x accepted the `imageSendTo` component but did not display the SVG data URL.
- Add a debug message when Admin requests and receives the sky plot, including satellite count and PNG byte size.
- Keep the existing SVG renderer as the source graphic; only the transport format to Admin changes.

# Changelog

## 0.2.15 (2026-07-17)

- Fix Admin JSONConfig validation for the RTK sky plot by using only properties supported by `imageSendTo`.
- Prevent parallel and repeated RTK satellite archive downloads.
- Refresh RTK satellite data at most once every five minutes unless the RTK ID or explicit satellite timestamp changes.
- Keep the last successfully decoded satellite data when a temporary cloud/download error occurs.
- Improve RTK satellite error logging with the nested cause of `AggregateError` and the next retry time.

## 0.2.14 (2026-07-17)

- Removed both unsupported `width` and `height` properties from the `imageSendTo` JSONConfig component for compatibility with ioBroker Admin 7.8.x.
- Reduced the RTK skyplot component to schema-safe properties only.
- Kept the backend response as a complete Base64 SVG data URL.


## 0.2.13 (2026-07-17)

- Corrected the release archive layout: adapter files now sit directly at ZIP root instead of inside `work_v0212`.
- Kept the JSONConfig skyplot component without the unsupported `width` property.
- Synchronized all package version fields to 0.2.13.

## 0.2.12 (2026-07-17)

- Fixed invalid ioBroker JSONConfig for the RTK satellite map.
- Removed the unsupported `width` property from `imageSendTo` for Admin 7.8.23 compatibility.
- The sky plot continues to use the valid responsive grid width and a fixed height.

## 0.2.10 (2026-07-17)

- Do not interpret numeric `rtk.state` values as Kevin's live GNSS fix; field tests showed that code `0` can occur while the mower GPS LED is steady.
- Render the RTK satellite sky plot through a live HTML state instead of `imageSendTo`, so the SVG is visible reliably in Admin.
- Display the moved-antenna boolean as “Ja/Nein” in the German Admin UI.

## 0.2.9 (2026-07-17)

- Show the RTK satellite sky plot directly in the Admin diagnostics.
- Arrange diagnostics as a left-hand value list with the sky plot on the right.
- Localize Admin diagnostic values and assessments for German configuration.
- React to map freshness fields received on the service shadow as well as the property shadow, so edited no-go zones can trigger a reload.
- Keep numeric mower GNSS codes unclassified until their meaning is proven.

## 0.2.8 (2026-07-17)

- Reverse engineered the Anthbot Genie 2.15.3 NetRTK satellite archive (`rtk_manager_<SN>.tar.gz` / `rtk_base_info.bin`).
- Added real RTK base satellite count, raw satellite list and SVG sky plot.
- Added automatic `req_rtk_base_info` refresh and satellite archive download with a five-minute guard.
- Map refresh now follows the same M9 shadow signals used by the app: `map.time`, `map.map_id`, `map.area_id`, `map.plan_id`, `map.state`, `map_time` and `area_time`.
- New No-Go zones and other map edits are reloaded automatically when the map signature changes.
- Kept HTTP shadow polling disabled while MQTT is connected to avoid 429 responses.

## 0.2.7 (2026-07-17)

- Fix false Kevin GNSS `lost` result caused by interpreting `rtk.state` as a robot fix.
- Keep unknown numeric RTK/GNSS codes raw instead of guessing their meaning.
- Add live GNSS/RTK status rows at the bottom of the Admin page.
- Disable periodic HTTP shadow polling completely while MQTT is connected.
- Add exponential 429 backoff (15/30/60/120 minutes) when HTTP polling is needed.
- Avoid the initial HTTP shadow request; MQTT requests both named shadows after connecting.

## 0.2.4 (2026-07-16)

## 0.2.6 (2026-07-17)

- Separates GNSS information for Kevin from RTK base-station information.
- Adds `diagnostics.gnss.robot.*`, `diagnostics.gnss.base.*` and `diagnostics.gnss.assessment.*`.
- Detects known and previously unknown GNSS/RTK fields without assigning base values to Kevin.
- Adds a cautious odometry indication only when Kevin is active, GNSS is unavailable and fresh movement data still exists.
- Adds an Admin information block explaining the difference between NetRTK base data and Kevin's own GNSS receiver.
- Removes obsolete installation text files from the package.
- Cleans internal package registry URLs from `package-lock.json`.


- Added AWS IoT MQTT-over-WebSocket live named-shadow subscriptions.
- Property changes from the Anthbot app are reflected immediately in ioBroker.
- Kept configurable HTTP polling as a 300-second safety fallback while MQTT is connected.
- Added MQTT diagnostics states.

# Changelog

## 0.2.5 (2026-07-17)

- Keep the accumulated mower track for the complete mowing task.
- Reset the track only when a new mower task id starts or on explicit clear.
- Increase the rendered track width for a closed, gap-free appearance.
- Raise the in-memory task track limit to 50,000 points.

## 0.2.3 (2026-07-16)

- Added two-stage idle polling: 60 seconds initially, 180 seconds after 10 minutes.
- Added optional night polling with configurable hours and interval.
- Added German Admin UI texts for all polling settings.
- Added polling-reason debug messages and scheduler tests.

## 0.2.2 (2026-07-16)

- Added separate configurable polling intervals for active, charging and idle states.
- Defaults changed to 30 seconds active and 60 seconds charging/idle.
- Added German labels and help texts for all three polling settings.
- Integrated fixed map origin for the charging station and M9 bridge decoder.
- Version aligned across package.json and io-package.json.

