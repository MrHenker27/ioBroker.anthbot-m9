# Changelog

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

