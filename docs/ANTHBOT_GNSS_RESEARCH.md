# Anthbot M9 GNSS / RTK research notes

## Confirmed separation

The NetRTK screen in the official Anthbot app belongs to the RTK/NetRTK setup and shows base-station-related connection, positioning and satellite information. A strong base status does not prove that the mower itself currently has a fixed GNSS solution.

Kevin must have a separate GNSS receiver because mapping is blocked while the mower's positioning indicator is blinking even when the NetRTK base screen reports a strong position and many satellites.

## App bundle findings

The official Android bundle contains positioning-related identifiers including `posegps`, `posStatus`, `pos_source`, `pos_board`, `ui_board` and `useRtkEvent`. Their presence supports separate positioning/event handling, but the exact payload ownership of every field is not fully proven.

## Adapter policy

The adapter does not copy base-station values into mower states. It uses explicit base paths such as `ctl_rtk_base`, `rtk_base` and `netrtk` only for `diagnostics.gnss.base.*`. Mower values are taken only from mower/pose/GNSS paths or clearly mower-level top-level fields.

Unknown GNSS/RTK-like fields are retained in `diagnostics.gnss.rawCandidates`. This allows real payloads to refine the protocol mapping without inventing values.

## Odometry

The official app and firmware behavior suggest sensor fusion may combine GNSS/RTK, IMU and wheel odometry. The adapter cannot prove which sensors are active from the current cloud payload. Therefore `assessment.odometryLikely` is explicitly an inference: Kevin is active, GNSS is not fixed, and fresh movement data is still received.

## Confirmed in Anthbot Genie 2.15.3

The app directly evaluates the mower shadow field `rtk.state`. It treats `rtk.state === 1` as sufficient RTK quality and displays an RTK weak warning for every other value. The app does not reveal a reliable detailed meaning for the remaining numeric codes. The adapter therefore maps code `1` to `fixed` and displays all other numeric values as `weak (<code>)` instead of guessing float/lost semantics.

The NetRTK satellite page obtains the base-station satellite list from `rtk_manager_<serial>.tar.gz` / `<rtk_id>/rtk_base_info.bin`. This is separate from the mower GNSS indicator. No separate mower satellite count was found in the reviewed cloud/React Native flow.

For no-go-zone completion, the app subscribes to generic device shadow messages and waits for a changed `area_time`. It does not restrict this listener to the named property shadow. The adapter must therefore accept map freshness fields from both property and service shadow messages.
