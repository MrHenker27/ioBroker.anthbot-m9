## 0.2.4 (2026-07-16)

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

