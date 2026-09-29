# Minimal Schedule Viewer

Version **0.1.4**. A lightweight Lovelace custom card for native Home Assistant schedule helpers. Shows a compact, color-coded weekly timeline and keeps editing in Home Assistant's standard interface.

## Features

- Monday through Sunday, 00:00–24:00, with ticks every three hours.
- Blocks proportional to duration, with a label and start/end time.
- Automatic title from the entity's `friendly_name`.
- Per-card YAML mappings, translated day labels, and visible data errors.
- Light/dark theme support, no dependencies, build step, HACS, or animations.

## Manual installation

1. Copy `minimal-schedule-viewer.js` to `/config/www/minimal-schedule-viewer.js`.
2. In **Settings → Dashboards → Resources**, add:
   - URL: `/local/minimal-schedule-viewer.js`
   - Type: **JavaScript Module**
3. Reload your browser and add a manual card using the example below.

Enable Advanced Mode in your user profile if Resources is hidden. If you just created the `www` directory for the first time, restart Home Assistant once. Replacing an existing JS file does not require an HA restart: hard-reload the browser. If an old copy persists, change the resource URL to `/local/minimal-schedule-viewer.js?v=0.1.4` (increment the suffix for subsequent updates), then reload the page.

Requires a native `schedule.*` entity and a Home Assistant version exposing [`schedule.get_schedule`](https://www.home-assistant.io/actions/schedule.get_schedule/) with response data. The signed-in user needs permission to read that schedule. No `schedule/list` fallback or separate integration is used.

## Dashboard example

```yaml
type: custom:minimal-schedule-viewer
entity: schedule.zeitplan_thermostat_kinderzimmer_1_auser_haus

data_key: modus

days:
  - Mo
  - Di
  - Mi
  - Do
  - Fr
  - Sa
  - So

states:
  komfort:
    label: Komfort
    color: "#2e8540"
  reduziert:
    label: Reduziert
    color: "#1976c9"
  abwesend:
    label: Abwesend
    color: "#f39a00"

grid_options:
  columns: 16
  rows: auto
```

**`grid_options: { columns: 16, rows: auto }` is useful for a comfortably wide weekly view.** In a Sections dashboard, ensure the containing section has enough width for 16 columns. Actual placement and the number of cards per row are controlled by your dashboard; this is not a fixed pixel width.

An English example using a different data field:

```yaml
type: custom:minimal-schedule-viewer
entity: schedule.living_room
data_key: mode
states:
  comfort:
    label: Comfort
    color: "#2e8540"
  away:
    label: Away
    color: "#f39a00"
# Omitted days defaults to Mon, Tue, Wed, Thu, Fri, Sat, Sun.
grid_options:
  columns: 16
  rows: auto
```

Both examples are also available in `examples/`.

## Configuration

| Option | Required | Description |
| --- | --- | --- |
| `type` | Yes | `custom:minimal-schedule-viewer` |
| `entity` | Yes | Native `schedule.*` entity |
| `data_key` | Yes | Exact key in each block's `data` object |
| `states` | Yes | Value-to-label/color mapping; `{}` makes all present values unknown |
| `days` | No | Seven non-empty strings, Monday first; defaults to `Mon, Tue, Wed, Thu, Fri, Sat, Sun` |
| `grid_options` | No | Home Assistant dashboard layout settings |

`data_key: modus` reads `data.modus` in each schedule block. It is a literal field name, not a dotted path. For example, a block may contain:

```yaml
from: "05:30:00"
to: "22:00:00"
data:
  modus: komfort
```

Each `states` entry requires a string `label` and a quoted hex `color`: `#RGB` or `#RRGGBB`. Matching is exact and case-sensitive; whitespace is not trimmed for matching. Numeric and boolean block values use their string representation as mapping keys (quote such keys in YAML). Text color is automatically black or white for contrast.

The source-level `TEXT_STYLES` near the top of the JS file exposes `.day_style`, `.hour_style`, `.schedule_name`, and `.schedule_time` for optional typography changes. Standard use requires only YAML configuration.

## Error display

| Condition | Display |
| --- | --- |
| Key absent, null, empty or whitespace-only string | Red block, `Missing value` |
| Present value not listed under `states` | Red block showing the raw value, e.g. `komofrt` |
| Missing/invalid times or an end not later than its start | Red diagnostic above the timeline naming the day and block; no fabricated placement |
| Overlapping blocks | Red blocks and a diagnostic |
| Unavailable entity or failed request | Error message; any retained schedule is explicitly marked as the last loaded data |

Empty space means no configured block. Labels and times truncate horizontally when narrow. The time line is hidden only if the block is too short vertically to show the complete line; the label remains. Block height always stays proportional to duration. Hover for complete details. Blocks are not clickable. Native hover tooltips may not be available on touch-only devices.

## Editing and refresh

The `>` button opens Home Assistant's native entity dialog, the same entry point used by the helper list. Depending on the HA version, choose its edit/settings control to reach the schedule editor. The card does not save anything. YAML-defined schedules remain subject to HA's own editing limitations and permissions.

Data reloads on attachment, reconnection, when returning to a visible browser tab, and once after closing the native dialog opened by this card. There is no periodic polling. Edits made elsewhere may require reopening/reloading the dashboard. The native dialog close event is a frontend integration point and may change in future HA releases.

## What this card does NOT do

- No editing.
- No scheduling logic or device control.
- No replacement for Home Assistant's native schedule editor.
- No visual configuration editor, separate schedule storage, or HACS dependency.

## Development

No build step. Run `node --check minimal-schedule-viewer.js` and `node --test minimal-schedule-viewer.test.cjs`. Tests cover configuration, parsing, request handling, and rendering with a simulated HA environment. A live HA smoke test is still recommended before release.
