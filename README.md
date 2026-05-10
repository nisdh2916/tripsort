# Pindrop

Pindrop is a PC browser workflow for organizing travel photo files. The primary outcome is a reviewable date/place organization plan and a ZIP export that preserves the original image bytes.

Maps, GPS, domestic/international scope, and AI labels are supporting context. They help Pindrop decide where photos belong, but they are not the product center.

## Core Features

| Feature | Description |
|------|------|
| Photo import | Import multiple JPG, JPEG, PNG, HEIC, and WEBP files in a PC browser |
| EXIF parsing | Read GPS coordinates and capture date from photo metadata |
| Date/place organization | Propose output paths such as `YYYY-MM-DD_Place/photo.jpg` |
| GPS place lookup | Convert GPS coordinates into human-readable places with Nominatim |
| GPS-missing handling | Keep GPS-missing photos in the workflow and infer/fallback instead of dropping them |
| AI labels | Use local Vision AI labels or captions as organization clues when available |
| Organization preview | Review proposed folders, filenames, confidence, and reasons before export |
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
    |-- GPS missing: VLM/file/folder clues
    |-- Still unclear: Unknown Date / Unknown Location
    |
Organization preview
    |
ZIP export with byte-preserved photo copies + manifest.json
```

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
| Backend | Python Flask |
| EXIF parsing | exifr.js |
| Reverse geocoding | OpenStreetMap Nominatim |
| Detail map preview | MapTiler + MapLibre |
| Vision AI | Ollama `llama3.2-vision` |
| Desktop auxiliary run | Electron |

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
python app.py
```

Open:

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

## Desktop Auxiliary Run

Electron can launch the same local Flask web service:

```powershell
npm run desktop
```

This is a convenience path, not a separate product identity.

## Verification

```powershell
python -m py_compile app.py tests/test_app.py
python -m unittest discover -s tests
npm run check:js
npm run test:unit
npm run test:e2e
npm run test:demo
```

## Project Structure

```text
pindrop/
|-- app.py
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
- GPS is useful but not required. GPS-missing photos must remain organizable.
- Original file movement must never happen without explicit user confirmation.
