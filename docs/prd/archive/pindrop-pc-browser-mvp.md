# Historical PRD: Pindrop Korea Map PC Browser MVP

> Status: Superseded by [Travel Photo File Organization MVP](../travel-photo-file-organization-mvp.md).
> This Korea-map-first PRD is retained as historical/supporting context only. The current product is **TripSort**: travel photo file organization, trip/date/place preview, manual trip grouping, and byte-preserving ZIP export. Maps are a supporting preview.

## 1. Introduction/Overview

Pindrop is a PC browser web service for organizing travel photos by location, domestic/international scope, and local AI analysis. The primary map experience is now a 대한민국 지도 for domestic photos, not a 3D globe. Overseas photos are separated from the domestic map experience instead of being mixed into one global view.

This PRD supersedes the earlier "3D globe first" MVP direction. The globe implementation may remain as legacy or a later optional world view, but it is no longer the core product identity. The revised MVP focuses on a more practical domestic travel workflow: Korean places, regional clustering, and ground transportation such as bus, KTX, SRT, regular rail, subway, and car.

## 2. Goals

- Let a PC browser user upload travel photos and see domestic GPS-backed photos on a 대한민국 지도.
- Automatically classify GPS-backed photos as domestic or international.
- Keep domestic photos in the primary map flow and overseas photos in a separate area or view.
- Represent domestic movement with ground transport modes such as bus, KTX, SRT, regular rail, subway, and car.
- Reserve airplane-style movement primarily for overseas trips or domestic island exceptions such as 제주/섬 travel.
- Keep EXIF GPS/date parsing, local AI tags/captions, persistence, filtering, export, and search as supporting capabilities.
- Keep Electron as an auxiliary execution method, not as the product identity.

## 3. User Stories

### US-001: Upload Travel Photos
**Description:** As a PC user with travel photos, I want to upload one or more image files so that Pindrop can organize them by location.

**Acceptance Criteria:**
- [ ] User can select supported image files from a PC browser file picker.
- [ ] User can drag and drop supported image files into the upload area.
- [ ] Supported formats are JPG, JPEG, PNG, HEIC, and WEBP.
- [ ] Files larger than the configured maximum are rejected with a visible message.
- [ ] Unsupported file types are rejected with a visible message.
- [ ] Multiple selected files are processed sequentially without freezing the UI.

### US-002: Extract EXIF Location And Date
**Description:** As a user, I want Pindrop to read GPS metadata from my photo files so that I do not need to enter locations manually.

**Acceptance Criteria:**
- [ ] EXIF GPS latitude and longitude are parsed in the browser before server upload.
- [ ] Capture date is parsed when available and shown in Korean date format.
- [ ] Photos with valid GPS proceed to scope classification and reverse geocoding.
- [ ] Photos without GPS do not create a map pin.
- [ ] Photos without GPS still appear in the sidebar with a "GPS 없음" status.

### US-003: Classify Domestic And International Photos
**Description:** As a user, I want Pindrop to separate domestic and overseas photos so that Korean trips stay easy to review.

**Acceptance Criteria:**
- [ ] A valid GPS coordinate is classified as `domestic` when it falls within the 대한민국 supported boundary.
- [ ] A valid GPS coordinate is classified as `international` when it falls outside the 대한민국 supported boundary.
- [ ] Reverse geocoding country data can refine or confirm the classification when available.
- [ ] Domestic and international counts are visible in the PC browser UI.
- [ ] The classification is persisted with each saved pin.

### US-004: Display Domestic Photos On 대한민국 지도
**Description:** As a user, I want Korean travel photos shown on a 대한민국 지도 so that domestic trips are easier to scan than on a globe.

**Acceptance Criteria:**
- [ ] The primary map view renders a 대한민국-focused map in the PC browser.
- [ ] Each domestic GPS-backed photo creates one visible pin at the correct latitude and longitude.
- [ ] Adding a domestic pin moves or fits the map to that location.
- [ ] Clicking a domestic pin opens a popup with photo preview, place, coordinates, date, tags, and caption when available.
- [ ] Domestic pins can be colored or grouped by region, tag, or active filter.

### US-005: Separate Overseas Photos
**Description:** As a user, I want overseas photos separated from the domestic map so that they do not clutter the Korea-focused workflow.

**Acceptance Criteria:**
- [ ] International photos appear in a distinct "해외" section, tab, or view.
- [ ] International photos keep their coordinates, place, date, tags, and captions.
- [ ] International photos do not appear as normal pins on the default 대한민국 지도.
- [ ] User can still inspect, delete, export, and search international photos.
- [ ] If a world view remains, it is presented as secondary to the 대한민국 지도.

### US-006: Choose Domestic Transport Mode
**Description:** As a user, I want to mark domestic movement as bus, KTX, SRT, or another ground mode so that routes match how I actually traveled.

**Acceptance Criteria:**
- [ ] Domestic route or trip segments can have a transport mode.
- [ ] Supported domestic modes include bus, KTX, SRT, regular rail, subway, car, airplane, ferry, and unknown.
- [ ] The default domestic mode is unknown until inferred safely or chosen by the user.
- [ ] Airplane is not the default domestic mode.
- [ ] 제주/섬 trips can use airplane or ferry without being treated as overseas.

### US-007: Show Domestic Routes With Ground-Movement Language
**Description:** As a user, I want domestic routes to look and read like ground travel so that the map feels relevant to Korea trips.

**Acceptance Criteria:**
- [ ] KTX/SRT/rail routes use train-oriented labels or iconography.
- [ ] Bus routes use bus-oriented labels or iconography.
- [ ] Car/subway/ferry/airplane modes have distinct labels or iconography.
- [ ] Route copy does not describe domestic movement as a flight unless airplane is explicitly selected.
- [ ] Route display remains useful even when the exact path cannot be calculated.

### US-008: Generate Local AI Tags And Captions
**Description:** As a user, I want Pindrop to label my photos using local AI so that I can review and filter photos by content.

**Acceptance Criteria:**
- [ ] Uploaded photos are sent to the local Flask backend for AI analysis when a saved filename exists.
- [ ] The backend uses Ollama `llama3.2-vision` for tag and caption generation when available.
- [ ] Tags are limited to the supported category vocabulary unless no suitable category exists.
- [ ] Tag generation does not block initial pin placement.
- [ ] Sidebar and popup update automatically when tags or captions are returned.
- [ ] If the vision model is unavailable, tagging/captioning is skipped or marked unavailable without breaking upload.

### US-009: Filter, Inspect, Delete, And Export Photos
**Description:** As a user, I want to narrow and manage my photo map so that I can review a specific trip or region.

**Acceptance Criteria:**
- [ ] User can filter by domestic/international scope.
- [ ] User can filter domestic pins by generated tag.
- [ ] User can filter pins by date range when date data exists.
- [ ] Sidebar items and map pins reflect active filters.
- [ ] User can click a sidebar item to focus the related map pin and open its popup.
- [ ] User can delete a pin from the sidebar or popup.
- [ ] User can export pin data as JSON, including scope and transport metadata.

### US-010: Search Existing Photos
**Description:** As a user, I want to search my saved photos with natural language so that I can find memories by content, place, or trip context.

**Acceptance Criteria:**
- [ ] Photos with server filenames can be indexed for search.
- [ ] Indexing includes place, date, scope, transport mode, tags, caption, and coordinates when available.
- [ ] Tags and captions trigger reindexing when they change.
- [ ] Search results focus or highlight matching sidebar items and map pins.
- [ ] Search can return domestic and international photos.
- [ ] If local search dependencies are unavailable, the UI fails gracefully.

### US-011: Run Through Desktop Auxiliary Execution
**Description:** As a PC user, I want an optional desktop launch path so that I can start the same Pindrop web service without manually running Flask.

**Acceptance Criteria:**
- [ ] `npm run desktop` starts Flask and opens the Pindrop UI.
- [ ] Electron readiness uses a lightweight `/ping` endpoint.
- [ ] If Flask is already running, Electron reuses it rather than starting a conflicting server.
- [ ] Electron is documented as an auxiliary execution method, not the core product identity.
- [ ] Electron defaults backend binding to `127.0.0.1` unless LAN exposure is explicitly requested.

### US-012: Demo The Revised Core Path With Real Photos
**Description:** As a presenter, I want a verified demo path with real GPS photos so that the Korea map direction can be shown reliably.

**Acceptance Criteria:**
- [ ] At least one real domestic GPS photo uploads successfully.
- [ ] The photo appears at the expected location on the 대한민국 지도.
- [ ] The sidebar shows place, date, domestic scope, and processing state.
- [ ] AI tags are generated or the missing-model state is clearly visible.
- [ ] A relevant search query returns the uploaded photo or a graceful unavailable state.
- [ ] No browser console errors appear during the core demo path.

## 4. Functional Requirements

- FR-1: The system must run as a PC browser web service served by Flask.
- FR-2: The system must allow image upload by file picker and drag-and-drop.
- FR-3: The system must validate uploaded file type and maximum size.
- FR-4: The system must parse EXIF GPS latitude, longitude, and capture date in the browser.
- FR-5: The system must classify GPS-backed photos as domestic or international.
- FR-6: The system must show domestic photos on the default 대한민국 지도.
- FR-7: The system must keep international photos separate from the default domestic map.
- FR-8: The system must reverse geocode valid coordinates and fall back to coordinate strings when needed.
- FR-9: The system must persist pin metadata across browser refreshes, including scope and transport fields.
- FR-10: The system must support domestic transport modes: bus, KTX, SRT, regular rail, subway, car, airplane, ferry, and unknown.
- FR-11: The system must not default domestic routes to airplane.
- FR-12: The system must allow inspecting, deleting, filtering, exporting, and searching saved photos.
- FR-13: The system must generate local AI tags and captions when Ollama dependencies are available.
- FR-14: The system must index saved photo metadata for natural language search when search dependencies are available.
- FR-15: The system must offer Electron desktop auxiliary execution for local convenience.

## 5. Non-Goals

- No mobile-first UI work in this MVP.
- No dedicated mobile app.
- No requirement that a phone browser be part of the primary demo.
- No paid cloud AI dependency for tagging, captions, or search.
- No user accounts, authentication, or multi-user collaboration.
- No cloud storage or remote sync.
- No full transit timetable integration.
- No guarantee of exact road, rail, bus, or ferry path reconstruction from photos alone.
- No automatic transport-mode inference unless confidence is high enough to avoid misleading the user.
- No requirement that the 3D globe remain the central visual object.

## 6. Design Considerations

- The first screen should remain the usable app experience, not a marketing landing page.
- The PC browser layout should prioritize upload, 대한민국 지도 exploration, sidebar review, domestic/international filtering, and AI readiness.
- Domestic and international scopes should be obvious without requiring the user to understand raw GPS coordinates.
- Domestic route language should use Korean travel expectations: 버스, KTX, SRT, 일반열차, 지하철, 자동차, 배, and only explicit airplane cases.
- Status states must be visible without developer tools: uploading, GPS missing, analyzing, complete, unavailable, and error.
- The old globe language should be avoided in user-facing copy unless a secondary world view is intentionally introduced.

## 7. Technical Considerations

- The frontend is HTML, CSS, and vanilla JavaScript today.
- The backend is Flask and exposes upload, pin persistence, AI, search, health, and ping endpoints.
- EXIF parsing runs in the browser through exifr.js so the backend does not need to parse metadata before upload.
- The existing Globe.gl implementation is legacy relative to this PRD and should be replaced or demoted by a Korea-focused map view.
- Domestic classification can start with a conservative 대한민국 bounding box, then improve with polygon boundaries or reverse geocode country data.
- Reverse geocoding uses OpenStreetMap Nominatim and must be treated as rate-limited.
- AI tagging/captioning uses local Ollama `llama3.2-vision`.
- Search reranking uses local Ollama `llama3.2` when available.
- Electron should check lightweight backend readiness through `/ping`; `/health` can remain for richer AI status.

## 8. Success Metrics

- A real domestic GPS photo can be uploaded and shown on the 대한민국 지도 within one demo flow.
- Domestic and international photos are visibly separated.
- Domestic travel is not represented as airplane travel unless explicitly selected.
- A photo without GPS is handled gracefully and visibly without creating a broken pin.
- Refreshing the PC browser restores previously saved photos with scope and transport metadata.
- Filtering by scope, tag, or date changes visible sidebar items and map pins predictably.
- Search can return a relevant saved photo after indexing, or displays a graceful unavailable state.
- The core PC browser demo path completes without browser console errors.
- `npm run desktop` opens the same Pindrop web service successfully as an auxiliary execution path.

## 9. Open Questions

- Which map rendering approach should replace the default globe: static SVG Korea map, Leaflet/OpenStreetMap tiles, Kakao/Naver map, or another local-friendly option?
- Should domestic/international classification use a simple bounding box first, or a more accurate Korea polygon from the start?
- Should transport mode be selected per route segment, per photo cluster, or per trip?
- How should 제주 and island travel be represented when it is domestic but often involves airplane or ferry?
