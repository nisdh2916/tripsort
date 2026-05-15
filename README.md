# TripSort

TripSort is a desktop app for organizing travel photo files. The primary outcome is a reviewable trip/date/place organization plan and a ZIP export that preserves the original image bytes.

Maps, GPS, domestic/international scope, and AI labels are supporting context. They help TripSort decide where photos belong, but they are not the product center.

## Workspace Model

TripSort opens on an organizer-first workspace. The primary view is photo import plus the reviewable trip/date/place folder preview, and the ZIP export path remains available without opening a map.

The map is an optional `지도 보기` tab for GPS-backed photos. MapTiler/MapLibre assets are loaded only when the map view is opened, so the first screen stays focused on file organization.

## Core Features

| Feature | Description |
|------|------|
| Photo import | Import multiple JPG, JPEG, PNG, HEIC, and WEBP files, including folder-level import for large batches |
| EXIF parsing | Read GPS coordinates and capture date from photo metadata |
| Trip/date/place organization | Propose output paths such as `Trip_YYYY-MM-DD_to_YYYY-MM-DD_Place/YYYY-MM-DD_Place/photo.jpg` |
| Automatic trip splitting | Split one import session into multiple trips using known capture-date gaps and accepted VLM trip signals |
| GPS place lookup | Convert GPS coordinates into human-readable places with Nominatim |
| GPS-missing handling | Keep GPS-missing photos in the workflow and infer/fallback instead of dropping them |
| AI labels/signals | Use local Vision AI labels, captions, and trip signals as organization clues when available |
| Organization preview | Review, merge/split trip groups, and edit trip folder names, dates, places, filenames, confidence, and reasons before export |
| ZIP export | Export organized copies without resizing, re-encoding, format conversion, or EXIF stripping |
| Map preview | Optional supporting preview for GPS-backed photos |

## Product Direction

The current PRD is [Travel Photo File Organization MVP](tasks/prd-travel-photo-file-organization-mvp.md).

The older Korea-map-first direction is superseded. MapTiler/MapLibre can remain as a supporting preview, but the first product promise is file organization and ZIP export.

## Data Flow

```text
Photo import
    |
EXIF parsing -> GPS/date metadata
    |
Place/date inference
    |-- GPS available: reverse geocode
    |-- GPS missing: VLM/file/folder clues and trip signals
    |-- Still unclear: Unknown Date / Unknown Location
    |
Trip grouping: import session + date gap + trip signal scoring
    |
Organization preview
    |
ZIP export with byte-preserved photo copies + manifest.json
```

## Sorting Model

TripSort creates a trip candidate from each browser import session, then splits or keeps photos together using deterministic scoring:

- known capture-date gaps greater than 3 days
- accepted VLM trip signals such as city and country
- manual `Merge previous` / `Split here` corrections stored as `tripGroupId`

VLM does not directly decide final trip groups. It provides structured signals; the preview remains reviewable and user-correctable.

## ZIP Quality Guarantee

ZIP export must preserve image bytes. The export path must not:

- resize images
- decode and re-encode images
- convert formats
- strip EXIF metadata
- write thumbnails instead of originals

Automated tests should compare SHA-256 hashes between stored source uploads and ZIP entries.

## Tech Stack

| Role | Technology |
|------|------|
| Frontend | HTML5 / CSS3 / Vanilla JS |
| Local backend | Python Flask |
| EXIF parsing | exifr.js |
| Reverse geocoding | OpenStreetMap Nominatim |
| Detail map preview | MapTiler + MapLibre |
| Vision AI | Ollama `llama3.2-vision` |
| Desktop app shell | Electron |

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
```

## Run As Desktop App

```powershell
npm run desktop
```

This opens TripSort as an Electron app window. The Flask service is started automatically on a private localhost port, and app data is stored under the OS app-data directory instead of the repository folder.

## Build Windows Installer

```powershell
npm run dist
```

The installer is written to `dist/` as `TripSort-Setup-0.1.0.exe`.

For a faster unpacked build without an installer:

```powershell
npm run pack
```

## Browser Dev Mode

Use this only when debugging the web surface directly:

```powershell
python app.py
```

Then open:

```text
http://127.0.0.1:5000/
```

## Optional MapTiler Key

The map is a supporting preview. It requires a MapTiler key in `.env`:

```dotenv
PINDROP_MAPTILER_KEY=your-maptiler-key
# PINDROP_MAP_STYLE_URL=https://api.maptiler.com/maps/streets-v2/style.json?key=your-maptiler-key
```

`.env` is ignored by git.

## Verification

```powershell
python -m py_compile app.py tests/test_app.py
python -m unittest discover -s tests
npm run check:js
npm run test:unit
npm run test:e2e
npm run test:demo
```

### Browser E2E prerequisites

The browser E2E scripts use Playwright Chromium. Install the managed browser with `npx playwright install chromium`, or point the tests at an existing Chromium-compatible binary with `PINDROP_CHROMIUM_EXECUTABLE` or `CHROME_BIN`.

## Project Structure

```text
tripsort/
|-- app.py
|-- desktop/
|   `-- main.cjs      # Electron desktop launcher
|-- build/
|   `-- icon.ico      # Windows installer/app icon
|-- index.html
|-- prd.json
|-- tasks/
|   `-- prd-travel-photo-file-organization-mvp.md
|-- uploads/            # temporary uploaded photos, ignored by git
|-- pins.json           # local session metadata, ignored by git
`-- static/
    |-- css/style.css
    `-- js/
        |-- exif.js
        |-- scope.js
        |-- globe.js    # supporting map preview
        `-- main.js
```

## Notes

- `uploads/` is temporary app storage, not the organized library.
- The installed desktop app stores uploads and `pins.json` in Electron `userData`, not beside the executable.
- GPS is useful but not required. GPS-missing photos must remain organizable.
- Original file movement must never happen without explicit user confirmation.
- Manual trip grouping overrides automatic scoring during preview and ZIP export.
