# Changelog Archive

Older changelog entries can be moved here after future releases.
## 0.1.3 (2026-05-08)

- Fix AWS IoT shadow access by using temporary Anthbot IoT credentials instead of the expired bundled AWS credentials.

## 0.1.2

- Limit `io-package.json` news entries for the ioBroker repository builder.

## 0.1.1

- Fix consumable lifetime mapping to match the Anthbot app labels: blades, cameras, and charging port.
- Highlight the extended telemetry, diagnostics, controls, and raw payload coverage in the README.
- Clean up repository readiness metadata and poll timer handling for ioBroker best practices.
- Align consumable lifetime and network diagnostic state roles with the documented ioBroker state role list.

## 0.1.0

- Add expanded diagnostics for model names, region fallback, errors, RTK, map, firmware, OTA, network, and GPS/location data.
- Add consumable reset buttons and correct the maintenance mapping for charging port, cameras, and blades.
- Add grouped command states for device, docking, maintenance, and mowing actions.
- Add writable mowing controls grouped by full-map, zone, near-charger, rain, and voice settings.
- Add full-map mowing control to include edge trimming.
- Fix near-charger mowing enable control to use the mower shadow setting.
- Remove unsupported camera-enabled and docking resume-return controls.

## 0.0.8

- Add consumable channels and values ​​to the adapter definition.

## 0.1.0-beta.2

- Add full-map mowing control to include edge trimming.
- Remove the unsupported camera-enabled control.
- Fix near-charger mowing enable control to use the mower shadow setting.
- Remove the docking resume-return command because the cloud command is not working reliably.

## 0.1.0-beta.1

- Add expanded diagnostics for model names, region fallback, errors, RTK, map, firmware, OTA, network, and GPS/location data.
- Correct consumable maintenance mapping to blades, cameras, and charging port.
- Add consumable reset buttons for charging port, cameras, and blades.
- Remove metric states duplicated by writable controls and group mowing controls by full-map, zone, and near-charger mowing.
- Group command states by device, docking, maintenance, and mowing with consistent action names.
- Refactor state layout into grouped metrics, diagnostics, consumables, zones, raw shadows, and rain controls while keeping single-entry controls flat.

## 0.1.0-beta.0

- Add mower action commands: find robot, grass dump, disk maintenance mode, edge mowing, near-charger mowing, and point mowing.
- Add task control commands: pause/continue mowing, pause/continue return-to-dock, and end mowing.
- Add RTK antenna moved warning cancel command.
- Add status and control states for mowing near the charging pile, including its mowing parameters.
- Add camera switch status and control.
- Add RTK antenna moved warning status.

## 0.0.9-beta.0

- Add mower service commands and controls.

## 0.0.8

Add consumable channels and values to the adapter definition.

## 0.0.7

- Add Dependabot automerge configuration and update repository metadata.

## 0.0.6

- Fix repository checker issues and move admin config translations to i18n files.

## 0.0.5

- Misc fixes.

## 0.0.4

- Add adapter icon, legal notice, German translations, and ensure the connection state object exists.

## 0.0.3

- Release 0.0.3.

## 0.0.2

- Release 0.0.2.

## 0.0.1

- Initial local adapter scaffold for Anthbot Genie.
