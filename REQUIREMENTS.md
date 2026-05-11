# TripSort Requirements

**Version:** 2.0
**Status:** supersedes the Korea-map-first requirements
**Primary goal:** travel photo file organization

## 1. Overview

TripSort is a PC browser workflow for turning a messy set of travel photos into a reviewable and exportable file organization. The MVP must propose a `trip -> date -> place` structure, let the user review the result, and export organized photo copies as a ZIP without quality loss.

Maps, GPS, domestic/international scope, and AI labels are supporting context only. They help infer dates, places, and confidence; they must not become the primary product workflow.

## 2. Terms

| Term | Definition |
|------|------------|
| Source photo | Original image selected by the user for organization |
| Organization preview | Proposed folder/file structure shown before export |
| Organized copy | Non-destructive copy placed into the proposed output structure |
| Export package | ZIP containing organized copies and `manifest.json` |
| Trip segment | A group of photos treated as one trip after import-session grouping and date-gap splitting |
| GPS context | EXIF coordinates, reverse-geocoded place, and scope metadata |
| Map preview | Optional visual check for GPS-backed photos |
| Unlocated photo | Photo without usable GPS that still remains in the organization workflow |

## 3. Functional Requirements

### 3.1 Import

| ID | Requirement |
|----|-------------|
| FR-IMPORT-1 | User can import multiple supported image files from the PC browser. |
| FR-IMPORT-2 | Supported formats are JPG, JPEG, PNG, HEIC, and WEBP. |
| FR-IMPORT-3 | Unsupported files are rejected with a visible error. |
| FR-IMPORT-4 | GPS-missing photos are still retained as source photos. |
| FR-IMPORT-5 | Imported files are stored as temporary app uploads, not as final organized output. |

### 3.2 Metadata Resolution

| ID | Requirement |
|----|-------------|
| FR-META-1 | EXIF `DateTimeOriginal` is the first capture date source. |
| FR-META-2 | File modified date is used when EXIF date is unavailable. |
| FR-META-3 | Photos without a reliable date use `Unknown Date`. |
| FR-META-4 | GPS-backed photos use reverse geocoding to propose a place. |
| FR-META-5 | GPS-missing photos use VLM, filename, folder name, or fallback clues where available. |
| FR-META-6 | Photos without a reliable place use `Unknown Location`. |
| FR-META-7 | Every proposed place stores confidence and reason text. |

### 3.3 Organization Preview

| ID | Requirement |
|----|-------------|
| FR-PREVIEW-1 | Default output path format is `Trip_<date-range>_<place>/YYYY-MM-DD_Place/filename.ext`. |
| FR-PREVIEW-2 | Folder and file names are sanitized for Windows-safe output. |
| FR-PREVIEW-3 | Duplicate output paths are made unique without overwriting. |
| FR-PREVIEW-4 | UI shows proposed folder, proposed filename, confidence, and reason. |
| FR-PREVIEW-5 | User can edit proposed trip folder name, date, place, and filename before export. |
| FR-PREVIEW-6 | Preview state persists across page reloads. |
| FR-PREVIEW-7 | One browser import session is treated as a trip candidate using `tripId`. |
| FR-PREVIEW-8 | Known capture-date gaps greater than 3 days split one trip candidate into multiple trip segments. |

### 3.4 ZIP Export

| ID | Requirement |
|----|-------------|
| FR-ZIP-1 | User can export the current organization preview as a ZIP. |
| FR-ZIP-2 | ZIP paths match the preview exactly. |
| FR-ZIP-3 | ZIP includes `manifest.json` at the archive root. |
| FR-ZIP-4 | Manifest includes original filename, stored filename, output path, date, place, confidence, and reason. |
| FR-ZIP-5 | ZIP entries preserve original image bytes. |
| FR-ZIP-6 | Export must not resize, decode/re-encode, convert format, or strip EXIF metadata. |
| FR-ZIP-7 | Automated tests compare SHA-256 hash of at least one source upload with its ZIP entry. |

### 3.5 Original File Movement

| ID | Requirement |
|----|-------------|
| FR-MOVE-1 | Original movement is separate from ZIP export. |
| FR-MOVE-2 | Original movement never runs automatically. |
| FR-MOVE-3 | User must confirm the source and destination plan before any move. |
| FR-MOVE-4 | Move action is disabled when original file access is unavailable. |
| FR-MOVE-5 | Move implementation must avoid overwriting destination files. |

### 3.6 Supporting Map Preview

| ID | Requirement |
|----|-------------|
| FR-MAP-1 | Map preview is optional and secondary to import, preview, and export. |
| FR-MAP-2 | GPS-backed photos can appear on the map preview. |
| FR-MAP-3 | GPS-missing photos remain visible in organization preview. |
| FR-MAP-4 | No core organization action requires opening or using the map. |

## 4. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-1 | Core workflow targets PC browser usage. |
| NF-2 | ZIP export must preserve photo bytes. |
| NF-3 | Missing VLM model must not block preview or ZIP export. |
| NF-4 | Nominatim requests must respect rate limits. |
| NF-5 | `.env`, uploads, logs, generated databases, and local session data must not be committed. |

## 5. Non-Goals

- No mobile-first workflow in this MVP.
- No cloud photo library integration.
- No automatic deletion of originals.
- No silent EXIF rewriting.
- No requirement that every photo have GPS.
- No map-first dashboard or map-first product identity.
- No multi-user accounts or remote sharing.

## 6. Verification

```powershell
python -m py_compile app.py tests/test_app.py
python -m unittest discover -s tests
npm run check:js
npm run test:unit
npm run test:e2e
npm run test:demo
```

Acceptance for the file-organization MVP requires a mixed demo with:

- at least one GPS-backed photo
- at least one GPS-missing photo with VLM inference or fallback
- ZIP contents matching preview paths
- SHA-256 equality between a stored source upload and ZIP entry
- no dependency on the map preview for export
