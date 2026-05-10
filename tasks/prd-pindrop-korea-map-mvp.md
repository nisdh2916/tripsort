# PRD: Pindrop Korea Map MVP

> Status: Superseded by [Travel Photo File Organization MVP](prd-travel-photo-file-organization-mvp.md).
> This Korea-map-first PRD is retained as historical/supporting context only. Pindrop's current primary goal is travel photo file organization and byte-preserving ZIP export; maps are a supporting preview.

## 1. Introduction/Overview

Pindrop is a PC browser web service for organizing travel photos by location, domestic/international scope, and local AI analysis. The revised MVP changes the product center from a 3D globe to a 대한민국 지도 because domestic Korean trips need regional precision, familiar place context, and ground-transport language more than a global visual effect.

The default experience is domestic-first: GPS photos taken in Korea appear on the Korea map, while overseas photos are separated into a distinct overseas area or secondary view. Domestic movement should be represented with bus, KTX, SRT, regular rail, subway, car, ferry, or unknown modes. Airplane should not be the default domestic route metaphor, except for explicit cases such as 제주 or island travel.

This PRD covers the next implementation direction after the previous globe-first MVP. Existing upload, EXIF, AI tagging/captioning, persistence, filtering, search, export, and Electron auxiliary execution remain valuable, but the map model and UI language must be realigned around Korea-first photo organization.

## 2. Goals

- Make 대한민국 지도 the default visual surface for domestic GPS-backed photos.
- Classify GPS-backed photos as `domestic` or `international`.
- Keep overseas photos accessible without mixing them into the default Korea map.
- Add domestic transport modes centered on bus, KTX, SRT, rail, subway, car, ferry, airplane, and unknown.
- Avoid showing domestic movement as airplane travel unless airplane is explicitly selected.
- Preserve current PC browser workflow: upload, inspect, filter, search, export, persist, and delete.
- Keep Electron as an auxiliary launch path for the same web service.
- Maintain graceful behavior when GPS, local AI, or search dependencies are unavailable.

## 3. User Stories

### US-001: Rename Product Direction From Globe To Korea Map
**Description:** As a developer, I want product copy and docs to describe Pindrop as a Korea-map-first photo organizer so that future work does not continue the old globe-first direction.

**Acceptance Criteria:**
- [ ] User-facing copy avoids presenting the 3D globe as the default product identity.
- [ ] README or requirements describe 대한민국 지도 as the default domestic view.
- [ ] Existing docs mention the globe only as legacy or optional secondary world view.
- [ ] Typecheck/lint passes where applicable.

### US-002: Add Scope Fields To Pin Data
**Description:** As a developer, I want each pin to store domestic/international scope so that the UI can separate Korea and overseas photos.

**Acceptance Criteria:**
- [ ] Pin data supports `regionScope: "domestic" | "international" | "unknown"`.
- [ ] Existing saved pins without `regionScope` load without crashing.
- [ ] New GPS-backed pins persist `regionScope`.
- [ ] JSON export includes `regionScope`.
- [ ] Backend tests cover save/load/export-compatible metadata.
- [ ] Typecheck/lint passes.

### US-003: Classify Coordinates By Korea Boundary
**Description:** As a user, I want GPS photos classified as domestic or overseas so that Korean trips stay focused on the Korea map.

**Acceptance Criteria:**
- [ ] Coordinates inside the supported Korea boundary classify as `domestic`.
- [ ] Coordinates outside the supported Korea boundary classify as `international`.
- [ ] Invalid or missing coordinates classify as `unknown` and do not create a map pin.
- [ ] Classification logic treats latitude `0` and longitude `0` as valid numeric values, not missing values.
- [ ] Unit tests cover domestic, international, boundary-adjacent, missing, and zero-coordinate cases.
- [ ] Typecheck/lint passes.

### US-004: Preserve Reverse Geocode As Place Enrichment
**Description:** As a user, I want readable place names after classification so that scope and place are both clear.

**Acceptance Criteria:**
- [ ] Reverse geocoding still runs for valid GPS coordinates.
- [ ] Place name priority remains city, town, village, county, state, country, then coordinate fallback.
- [ ] Reverse geocode failure does not prevent region classification.
- [ ] If reverse geocode returns country data, it can confirm or refine scope without overriding obvious coordinate classification incorrectly.
- [ ] Backend tests cover success and failure paths.
- [ ] Typecheck/lint passes.

### US-005: Render Korea Map View
**Description:** As a user, I want the default map to show Korea so that domestic trip photos are easy to scan.

**Acceptance Criteria:**
- [ ] Main visual area renders a Korea-focused map instead of the globe as the default view.
- [ ] The map is visible at desktop viewport size without overlapping the sidebar.
- [ ] The map has a nonblank rendered surface in browser verification.
- [ ] Existing app shell, upload controls, sidebar, and AI status remain visible.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-006: Plot Domestic Pins On Korea Map
**Description:** As a user, I want domestic GPS photos to appear at their actual locations on the Korea map so that I can review where I traveled.

**Acceptance Criteria:**
- [ ] Each domestic GPS-backed photo creates one visible map pin.
- [ ] Pin latitude and longitude match parsed EXIF coordinates.
- [ ] Adding a domestic pin moves, pans, or fits the map to that location.
- [ ] Clicking a domestic pin opens a popup with photo preview, place, coordinates, date, tags, and caption when available.
- [ ] Browser smoke test verifies at least one domestic fixture appears at the expected map coordinates.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-007: Separate Overseas Photos From Default Map
**Description:** As a user, I want overseas photos separated from domestic photos so that they do not clutter the Korea map.

**Acceptance Criteria:**
- [ ] International GPS-backed photos are saved and shown in a distinct overseas section, tab, or view.
- [ ] International photos do not appear as normal pins on the default Korea map.
- [ ] International photo list items show place, date, tags, caption status, and coordinates when available.
- [ ] User can inspect and delete international photos.
- [ ] Browser test covers one international coordinate and verifies it is separated from domestic map pins.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-008: Add Domestic/Overseas Scope Filter
**Description:** As a user, I want to switch between all, domestic, and overseas photos so that I can focus the review.

**Acceptance Criteria:**
- [ ] UI includes scope filter options: all, domestic, international.
- [ ] Domestic filter shows domestic photos and domestic map pins.
- [ ] International filter shows overseas photos without forcing them onto the Korea map.
- [ ] Empty state appears when the selected scope has no photos.
- [ ] Active scope filter is visually clear.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-009: Add Domestic Transport Mode To Pins Or Segments
**Description:** As a user, I want to mark domestic movement mode so that routes match how I actually traveled.

**Acceptance Criteria:**
- [ ] Data model supports `transportMode: "unknown" | "bus" | "ktx" | "srt" | "rail" | "subway" | "car" | "ferry" | "airplane"`.
- [ ] New domestic photos or route segments default to `unknown`, not `airplane`.
- [ ] Existing saved pins without `transportMode` load as `unknown`.
- [ ] JSON export includes `transportMode`.
- [ ] Search indexing includes `transportMode`.
- [ ] Typecheck/lint passes.

### US-010: Let User Choose Domestic Transport Mode
**Description:** As a user, I want to choose bus, KTX, SRT, or another mode so that Pindrop does not guess incorrectly.

**Acceptance Criteria:**
- [ ] Domestic photo or route detail UI exposes a transport mode selector.
- [ ] Selector options are labeled in Korean: 알 수 없음, 버스, KTX, SRT, 일반열차, 지하철, 자동차, 배, 비행기.
- [ ] Current value is shown when reopening the item.
- [ ] Changing the value persists after refresh.
- [ ] Airplane selection is allowed but never auto-selected by default.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-011: Show Ground-Transport Route Language
**Description:** As a user, I want domestic routes to read like ground travel so that the map feels natural for Korea trips.

**Acceptance Criteria:**
- [ ] Bus mode uses bus-oriented label or iconography.
- [ ] KTX/SRT/rail modes use train-oriented label or iconography.
- [ ] Subway, car, ferry, airplane, and unknown modes have distinct labels.
- [ ] Domestic route copy does not say "flight" or show airplane language unless `transportMode` is `airplane`.
- [ ] If exact route geometry is unavailable, UI shows a simple connection or sequence without pretending to know the exact path.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-012: Handle 제주 And Island Exceptions
**Description:** As a user, I want 제주 and island travel to remain domestic even when the route uses airplane or ferry.

**Acceptance Criteria:**
- [ ] 제주 and Korean island coordinates classify as `domestic`.
- [ ] Domestic airplane and ferry modes are allowed for 제주/island travel.
- [ ] UI does not move 제주/island photos into overseas solely because airplane is selected.
- [ ] Tests cover a 제주 coordinate and an overseas coordinate with distinct classification results.
- [ ] Typecheck/lint passes.

### US-013: Update Tag And Date Filters For Map Scope
**Description:** As a user, I want existing tag/date filters to work with the Korea map and overseas separation so that previous review workflows still work.

**Acceptance Criteria:**
- [ ] Tag filters update sidebar visibility for domestic and international photos.
- [ ] Date range filters update sidebar visibility for domestic and international photos.
- [ ] Domestic map pins update or de-emphasize based on active tag/date filters.
- [ ] Filters combine predictably with scope filter.
- [ ] Clear actions restore otherwise visible photos.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-014: Update Search Metadata For Scope And Transport
**Description:** As a user, I want search to understand domestic/overseas scope and transport mode so that queries like "KTX 부산" can find relevant photos.

**Acceptance Criteria:**
- [ ] Indexing includes `regionScope`.
- [ ] Indexing includes `transportMode`.
- [ ] Indexing still includes filename, place, date, tags, caption, latitude, and longitude.
- [ ] Reindex rebuilds missing entries with scope and transport metadata.
- [ ] Backend tests cover index and reindex payload metadata.
- [ ] Typecheck/lint passes.

### US-015: Search And Highlight Korea Map Results
**Description:** As a user, I want natural language search results to highlight matching photos on the Korea map or overseas list.

**Acceptance Criteria:**
- [ ] Search input remains visible in the PC browser UI.
- [ ] Submitting a query calls the backend search endpoint.
- [ ] Domestic search results highlight matching sidebar items and Korea map pins.
- [ ] International search results highlight matching overseas list items.
- [ ] Empty search results show a clear empty state.
- [ ] Unavailable local search dependencies show a graceful error state.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-016: Keep Local AI Tag And Caption Flow
**Description:** As a user, I want local AI tags and captions to continue working after the map model changes so that content organization is preserved.

**Acceptance Criteria:**
- [ ] Uploaded photos with saved filenames still call tag analysis when the vision model is available.
- [ ] Sidebar and popup update when tags are returned.
- [ ] Captions are saved back to pin data when generated.
- [ ] Missing vision model state remains visible and does not break upload.
- [ ] Tags and captions persist after refresh.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-017: Keep Delete And Export Workflows
**Description:** As a user, I want to delete and export photos after the Korea map change so that photo management remains complete.

**Acceptance Criteria:**
- [ ] Sidebar delete works for domestic photos.
- [ ] Sidebar delete works for international photos.
- [ ] Popup/detail delete removes the selected photo from UI and backend storage.
- [ ] Exported JSON includes id, coordinates, place, date, filename, tags, caption when present, `regionScope`, and `transportMode`.
- [ ] Export is blocked with a visible message when there are no photos.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-018: Update PC Browser Smoke Test
**Description:** As a developer, I want the smoke test to verify the Korea map workflow so that the new default experience stays demoable.

**Acceptance Criteria:**
- [ ] Smoke test starts or targets a running Flask server.
- [ ] Smoke test verifies the Korea map container renders.
- [ ] Smoke test verifies domestic fixture pin placement.
- [ ] Smoke test verifies overseas fixture separation.
- [ ] Smoke test verifies AI status UI is visible.
- [ ] Smoke test fails on uncaught browser console errors.
- [ ] Typecheck/lint passes.
- [ ] Tests pass.

### US-019: Update Real-Photo Demo Test
**Description:** As a presenter, I want a verified real-photo demo path for the Korea map direction so that the project can be shown reliably.

**Acceptance Criteria:**
- [ ] A real domestic GPS photo uploads successfully in the PC browser.
- [ ] The uploaded photo appears at the expected Korea map location.
- [ ] The sidebar shows place, date, domestic scope, and processing state.
- [ ] AI tags are generated or the missing-model state is clearly visible.
- [ ] Caption appears in popup or saved pin data when generated.
- [ ] A relevant search query returns the uploaded photo or a graceful unavailable state.
- [ ] No browser console errors appear during the demo path.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-020: Preserve Electron Auxiliary Execution
**Description:** As a PC user, I want Electron launch to keep opening the same web service so that the auxiliary execution path remains useful.

**Acceptance Criteria:**
- [ ] `npm run desktop` starts Flask when it is not already running.
- [ ] Electron checks `/ping` for readiness before opening the window.
- [ ] Electron reuses an already-running backend on port 5000.
- [ ] Electron opens the same Pindrop web service UI with the Korea map direction.
- [ ] Electron defaults backend binding to `127.0.0.1` unless LAN exposure is explicitly requested.
- [ ] Typecheck/lint passes.

## 4. Functional Requirements

- FR-1: The system must run as a PC browser web service served by Flask.
- FR-2: The system must allow image upload by file picker and drag-and-drop.
- FR-3: The system must validate uploaded file type and maximum size.
- FR-4: The system must parse EXIF GPS latitude, longitude, and capture date in the browser.
- FR-5: The system must classify GPS-backed photos as `domestic`, `international`, or `unknown`.
- FR-6: The system must show domestic GPS-backed photos on the default Korea map.
- FR-7: The system must keep international GPS-backed photos separate from the default Korea map.
- FR-8: The system must persist `regionScope` for each saved pin.
- FR-9: The system must support `transportMode` values: `unknown`, `bus`, `ktx`, `srt`, `rail`, `subway`, `car`, `ferry`, and `airplane`.
- FR-10: The system must default domestic `transportMode` to `unknown`, not `airplane`.
- FR-11: The system must allow users to change domestic transport mode.
- FR-12: The system must allow domestic airplane or ferry mode for 제주 and island travel without changing scope to international.
- FR-13: The system must reverse geocode valid coordinates and fall back to coordinate strings when needed.
- FR-14: The system must show photos without GPS in the sidebar with a clear "GPS 없음" state and no map pin.
- FR-15: The system must preserve existing local AI tag and caption behavior where possible.
- FR-16: The system must show AI readiness for Flask, Ollama, vision tagging/captioning, and search reranking.
- FR-17: The system must preserve pin persistence across refreshes.
- FR-18: The system must allow filtering by scope, tag, and date.
- FR-19: The system must allow deleting domestic and international photos.
- FR-20: The system must export saved photo metadata as JSON, including scope and transport fields.
- FR-21: The system must index saved photo metadata for natural language search when search dependencies are available.
- FR-22: The system must reindex pins when tags, captions, scope, or transport mode changes.
- FR-23: The system must keep Electron desktop auxiliary execution as a convenience launch path for the same web service.

## 5. Non-Goals

- No mobile-first UI work in this MVP.
- No dedicated mobile app.
- No requirement that a phone browser be part of the primary demo.
- No paid cloud AI dependency for tagging, captions, or search.
- No user accounts, authentication, cloud sync, or multi-user collaboration.
- No full public transit timetable integration.
- No exact road, bus, rail, or ferry route reconstruction from photos alone.
- No automatic transport-mode inference unless confidence is high enough to avoid misleading the user.
- No requirement that the 3D globe remain the central visual object.
- No full international map experience in this MVP unless it is needed to keep overseas photos inspectable.
- No production-grade packaged installer guarantee beyond preserving the existing auxiliary build path.

## 6. Design Considerations

- The first screen should remain the usable app experience, not a landing page.
- The main visual hierarchy should prioritize the Korea map, upload area, sidebar review, scope filter, and AI readiness.
- Domestic and international scopes should be legible without requiring users to inspect raw GPS coordinates.
- Domestic movement labels should use Korean travel language: 버스, KTX, SRT, 일반열차, 지하철, 자동차, 배, 비행기.
- The UI must not imply domestic travel is a flight unless airplane is explicitly selected.
- Cards should be used for individual list items or detail panels, not as nested decorative layout containers.
- Text must fit in controls at desktop viewport widths.
- The previous globe language should be avoided in user-facing copy unless a secondary world view is intentionally introduced.

## 7. Technical Considerations

- Current frontend stack is HTML, CSS, and vanilla JavaScript.
- Current backend is Flask with upload, pin persistence, AI, search, health, and ping endpoints.
- Existing Globe.gl code should be treated as legacy and replaced or demoted behind a secondary view.
- The first Korea map implementation should be simple enough to ship incrementally. Acceptable candidates include static SVG Korea map, Leaflet/OpenStreetMap tiles, or a local-friendly map component.
- Domestic classification may start with a conservative Korea bounding box plus 제주 coverage, then move to polygon boundaries if false positives become a problem.
- Reverse geocoding uses OpenStreetMap Nominatim and must remain rate-limited.
- AI tagging/captioning uses local Ollama `llama3.2-vision`.
- Search reranking uses local Ollama `llama3.2` when available.
- Persisted pins may need migration/defaulting for `regionScope` and `transportMode`.
- Tests should avoid relying on third-party map tile availability where practical; map rendering can be mocked in smoke tests.
- Electron should continue checking lightweight backend readiness through `/ping`; `/health` remains for richer AI status.

## 8. Success Metrics

- A real domestic GPS photo uploads and appears at the expected Korea map location in one demo flow.
- Domestic and international photos are visibly separated.
- Domestic route UI defaults to unknown/ground-travel language, never airplane.
- 제주 or island domestic travel can be represented with airplane or ferry without being marked overseas.
- A photo without GPS is handled gracefully and visibly without creating a broken map pin.
- Refreshing the PC browser restores saved photos with scope and transport metadata.
- Filtering by scope, tag, or date updates visible sidebar items and map pins predictably.
- Search returns a relevant saved photo after indexing or displays a graceful unavailable state.
- The PC browser smoke and real-photo demo paths complete without browser console errors.
- Electron opens the same Pindrop web service as an auxiliary execution path.

## 9. Open Questions

- Which map rendering approach should replace the default globe: static SVG Korea map, Leaflet/OpenStreetMap tiles, Kakao/Naver map, or another local-friendly option?
- Should MVP domestic classification use a simple bounding box first, or implement a more accurate Korea polygon immediately?
- Should `transportMode` belong to each photo, each route segment between photos, or a higher-level trip object?
- Should overseas photos be shown as a list only in MVP, or should they get a secondary world map view?
- Should 제주/island exception logic be coordinate-based only, or should reverse geocoded administrative region also participate?
