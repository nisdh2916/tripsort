# PRD: Travel Photo File Organization MVP

## 1. Introduction/Overview

TripSort의 제품 중심을 지도 탐색이 아니라 여행 사진 파일 정리로 재설정한다. 사용자는 PC 브라우저에서 여행 사진을 가져오고, 앱은 촬영일, 장소, VLM trip signal을 사용해 `여행 → 날짜/장소 → 파일` 기준의 정리 미리보기를 만든다. 사용자는 미리보기를 검토한 뒤 정리된 사진 ZIP을 다운로드할 수 있다. 원본 이동은 ZIP export와 분리된 안전 기능이며, 자동으로 실행하지 않는다.

지도, GPS, 국내/해외 구분, AI 태그, VLM trip signal은 정리 품질을 높이는 보조 맥락이다. GPS가 없는 사진도 버리지 않고 EXIF 날짜, 파일명, 기존 폴더명, VLM 분석 결과를 사용해 정리 후보를 만들며, 그래도 판단이 어려우면 fallback 위치에 정리한다.

## 2. Goals

- 업로드 또는 가져온 모든 지원 이미지 파일을 정리 후보로 만든다.
- 기본 정리 구조를 `여행 → 날짜/장소 → 파일` 기준으로 제안한다.
- GPS가 있는 사진은 좌표와 역지오코딩을 사용해 장소를 제안한다.
- GPS가 없는 사진은 VLM, 파일명, 폴더명, 촬영일/수정일을 사용해 장소 또는 주제 기반 fallback을 제안한다.
- 사용자가 정리 결과를 적용하기 전에 여행 그룹, 폴더명, 날짜, 장소, 파일명을 검토하고 수정할 수 있게 한다.
- 검토된 정리 결과를 ZIP 파일로 다운로드할 수 있게 한다.
- 원본 이동은 ZIP export와 분리하고, 사용자 확인 후에만 실행 가능한 별도 안전 기능으로 둔다.

## 3. User Stories

### US-001: Reframe Product Copy Around File Organization
**Description:** As a developer, I want product copy and docs to describe TripSort as a travel photo file organizer so that future work does not drift back to map-first behavior.

**Acceptance Criteria:**
- [x] README describes the primary outcome as organized photo files or ZIP export.
- [x] `docs/project/requirements.md` describes maps as a supporting preview, not the primary product goal.
- [x] Existing Korea-map PRD language is marked superseded or moved to supporting context.
- [x] Typecheck/lint passes where applicable.

### US-002: Store Source Photo Organization Metadata
**Description:** As a developer, I want each imported photo to have organization metadata so that the app can build a deterministic preview and export.

**Acceptance Criteria:**
- [x] Each photo record stores original filename, stored filename, MIME type, file size, and upload/import timestamp.
- [x] Each photo record stores candidate capture date, candidate place, confidence, and reason text.
- [x] Photos without GPS still persist as organization candidates.
- [x] Existing pin/search metadata remains backward compatible or is migrated safely.
- [x] Backend tests cover GPS-backed and GPS-missing records.

### US-003: Import Every Supported Image Into The Workflow
**Description:** As a user, I want every supported photo I select to appear in the organization workflow so that GPS-missing photos are not silently dropped.

**Acceptance Criteria:**
- [x] JPG, JPEG, PNG, HEIC, and WEBP files are accepted using existing size limits.
- [x] GPS-backed photos continue through upload, metadata extraction, and preview generation.
- [x] GPS-missing photos are uploaded or retained as source photos instead of stopping at sidebar-only state.
- [x] Unsupported files show an error and are excluded from the preview.
- [x] Verify in browser using dev-browser skill.

### US-004: Resolve Capture Date With Fallbacks
**Description:** As a user, I want photos grouped by the best available date so that the organized ZIP is easy to browse chronologically.

**Acceptance Criteria:**
- [x] EXIF `DateTimeOriginal` is the first capture date source.
- [x] If EXIF date is unavailable, file modified date is used when available.
- [x] If no reliable date exists, the photo is grouped under `Unknown Date`.
- [x] Date folder names use a deterministic format such as `YYYY-MM-DD`.
- [x] Unit or backend tests cover EXIF date, file modified date, and unknown date fallback.

### US-005: Resolve Place For GPS-Backed Photos
**Description:** As a user, I want GPS-backed photos grouped by place so that the output folders match where the trip happened.

**Acceptance Criteria:**
- [x] GPS coordinates are reverse geocoded using the existing reverse geocode flow.
- [x] Place names are sanitized for folder names.
- [x] Reverse geocode failure falls back to a coordinate-based or `Unknown Location` label.
- [x] Domestic/international scope can be kept as metadata but does not replace the date/place folder rule.
- [x] Backend or browser tests cover success and failure cases.

### US-006: Infer Place For GPS-Missing Photos
**Description:** As a user, I want GPS-missing photos still organized using other clues so that screenshots, camera photos, or stripped images remain useful.

**Acceptance Criteria:**
- [x] GPS-missing photos are analyzed with available VLM support when the model is installed.
- [x] The inference prompt asks for place clues, landmarks, signs, venue names, and broad scene context.
- [x] Filename and source folder name can be included as weak clues.
- [x] The system records a confidence value or confidence bucket for inferred places.
- [x] VLM inference records trip signals such as city, country, landmark, and scene type when available.
- [x] Low-confidence or unavailable inference falls back to `Unknown Location`.
- [x] Missing VLM model does not block ZIP export.
- [x] Browser or backend tests cover VLM success, VLM unavailable, and low-confidence fallback.

### US-007: Generate Default Organization Paths
**Description:** As a user, I want the app to propose clear folder paths so that I can understand the final ZIP before downloading it.

**Acceptance Criteria:**
- [x] Default path format is `Trip_<date-range>_<Place>/YYYY-MM-DD_<Place>/<filename>`.
- [x] `Unknown Date` and `Unknown Location` are used when date or place cannot be resolved.
- [x] Invalid filesystem characters are removed or replaced.
- [x] Duplicate filenames in the same folder are made unique without overwriting.
- [x] Trip splitting can use accepted high/medium trip signals in addition to capture-date gaps.
- [x] Tests cover duplicate names, unsafe characters, unknown date, and unknown place.

### US-008: Show Organization Preview Tree
**Description:** As a user, I want to review the proposed folder and file structure before export so that I can catch mistakes.

**Acceptance Criteria:**
- [x] The UI shows a tree or grouped list by date and place.
- [x] Each photo row shows thumbnail, original filename, proposed folder, proposed filename, and reason/confidence.
- [x] GPS-backed, VLM-inferred, and fallback decisions are visually distinguishable.
- [x] Preview updates when new photos are added or metadata changes.
- [x] Verify in browser using dev-browser skill.

### US-009: Edit Proposed Organization Before Export
**Description:** As a user, I want to correct a trip folder name, photo date, place, or filename before export so that the final ZIP matches my intent.

**Acceptance Criteria:**
- [x] User can edit proposed trip folder name for a trip segment.
- [x] User can merge adjacent trip segments.
- [x] User can split a trip segment at a selected photo.
- [x] User can edit proposed place for a photo.
- [x] User can edit proposed date group for a photo.
- [x] User can edit proposed filename for a photo.
- [x] Changes immediately update the organization preview path.
- [x] Edited values are persisted in the app session.
- [x] Verify in browser using dev-browser skill.

### US-010: Export Organized ZIP
**Description:** As a user, I want to download a ZIP containing organized photo copies so that I can keep the cleaned library outside TripSort.

**Acceptance Criteria:**
- [x] Export button creates a ZIP from the current approved preview.
- [x] ZIP folder paths match the preview exactly.
- [x] Original image bytes are preserved in the ZIP.
- [x] ZIP export does not resize, decode/re-encode, convert format, or strip EXIF metadata from image files.
- [x] Backend or e2e test compares SHA-256 hashes for at least one source upload and its ZIP entry.
- [x] ZIP includes a `manifest.json` with original filename, output path, date, place, confidence, and reason.
- [x] Export works when some photos have unknown date or unknown location.
- [x] Backend or e2e tests verify ZIP contents and manifest.
- [x] Verify in browser using dev-browser skill.

### US-011: Confirm Original File Move
**Description:** As a user, I want to move original photos only after explicit confirmation so that the app never destructively changes my library by accident.

**Acceptance Criteria:**
- [x] Original move is separate from ZIP export and is never automatic.
- [x] UI clearly explains that original files may be moved.
- [x] User must confirm after seeing the exact source and destination plan.
- [x] Move action is disabled when the browser/session cannot access original file paths.
- [x] Verify in browser using dev-browser skill.

### US-012: Move Originals Safely When Supported
**Description:** As a user with a supported local source workflow, I want confirmed original moves to follow the preview so that my local folder becomes organized.

**Acceptance Criteria:**
- [x] The implementation documents the required access mode, such as File System Access API or desktop auxiliary permissions.
- [x] The move operation validates that every source file still exists before moving anything.
- [x] The move operation avoids overwriting destination files.
- [x] Partial failures are reported with per-file status.
- [x] A manifest or log is written for completed moves.
- [x] Tests cover duplicate destinations and missing source files where feasible.

### US-013: Keep Map As A Supporting Preview
**Description:** As a user, I want to optionally inspect GPS-backed photos on a map so that I can validate location context without leaving the organization workflow.

**Acceptance Criteria:**
- [x] Map preview is visually secondary to import, preview, and export controls.
- [x] The default workspace opens on organization results, not the map.
- [x] The map is shown from a `지도 보기` tab or equivalent on-demand control.
- [x] MapTiler/MapLibre assets are not required for the initial organization view.
- [x] Map preview shows GPS-backed photos only when coordinates are available.
- [x] GPS-missing photos remain visible in the organization preview.
- [x] No core file organization action requires opening the map.
- [x] Verify in browser using dev-browser skill.

### US-014: Verify With Mixed Realistic Inputs
**Description:** As a developer, I want a realistic demo path with mixed photo metadata so that regressions are caught before implementation continues.

**Acceptance Criteria:**
- [x] Demo includes at least one GPS-backed photo.
- [x] Demo includes at least one GPS-missing photo with VLM inference.
- [x] Demo includes at least one GPS-missing photo that falls back to `Unknown Location`.
- [x] Demo verifies preview paths and ZIP contents.
- [x] Demo verifies that map preview is not required for export.

## 4. Functional Requirements

- FR-1: The system must treat every supported selected image as a source photo, even when GPS is missing.
- FR-2: The system must extract EXIF GPS and capture date when available.
- FR-3: The system must derive a capture date using `EXIF date → file modified date → Unknown Date`.
- FR-4: The system must derive a place using `GPS reverse geocode → VLM/metadata inference → Unknown Location`.
- FR-5: The system must store the reason and confidence for each proposed place.
- FR-6: The system must generate default output paths using `trip → date/place → file`.
- FR-7: The system must sanitize folder and file names for Windows-safe output.
- FR-8: The system must prevent duplicate output paths from overwriting files.
- FR-9: The system must show an organization preview before export or original move.
- FR-10: The system must allow user edits to proposed trip grouping, trip folder name, date, place, and filename.
- FR-11: The system must export a ZIP whose contents match the current preview.
- FR-12: The system must preserve original image bytes in ZIP entries without image resizing, re-encoding, format conversion, or EXIF stripping.
- FR-13: The system must verify byte preservation with SHA-256 hash comparison in automated tests.
- FR-14: The system must include a manifest in the ZIP.
- FR-15: The system must never move original files without explicit user confirmation.
- FR-16: The system must disable original move when source file access is unavailable.
- FR-17: The system must keep maps as optional supporting previews for GPS-backed photos.
- FR-18: The system must show the organization workspace by default and open the map only on demand.

## 5. Non-Goals

- No mobile-first upload or phone workflow in this MVP.
- No cloud photo-library integration such as Google Photos, iCloud, or Dropbox.
- No automatic deletion of originals.
- No silent in-place rewriting of EXIF metadata.
- No requirement that every photo have GPS.
- No requirement that VLM inference be perfect or always available.
- No map-first dashboard or map-first product identity.
- No multi-user accounts or remote sharing.

## 6. Design Considerations

- The first screen should prioritize import, organization preview, and export.
- The map should live behind a secondary map tab or equivalent on-demand view.
- Small screens should keep sidebar navigation scrollable and expose it as a drawer when horizontal or vertical space is constrained.
- Every inferred decision should explain why it was made: GPS, VLM, filename, folder name, or fallback.
- Low-confidence inferred places should be easy to spot and edit.
- The ZIP export button should be available only when at least one valid source photo exists.
- Original move should use stronger warning copy than ZIP export because it changes the user's local files.

## 7. Technical Considerations

- Plain browser file uploads do not expose original local file paths, so true original-file movement requires a supported access mode such as the File System Access API or a desktop auxiliary path.
- ZIP export can be implemented from server-stored uploaded copies without source filesystem access.
- ZIP export should add files from stored upload bytes directly; it must not open and save images through PIL or browser canvas for the export path.
- Existing `uploads/` should be treated as temporary app storage, not the organized library.
- Existing `pins.json` may need to evolve into or be supplemented by a richer organization manifest.
- Existing MapTiler/MapLibre code can remain as map preview support, but should not own the main workflow.
- VLM inference should degrade gracefully when the local model is missing.
- Folder names must be safe on Windows because the current primary environment is PC browser on Windows.

## 8. Success Metrics

- A user can import a mixed batch of photos and see an organization preview without manually entering GPS.
- A user can correct automatic trip grouping with merge/split controls before export.
- A user can download a ZIP whose folder structure matches the preview.
- A ZIP entry for an exported photo has the same SHA-256 hash as the stored source upload.
- GPS-missing photos are included in the ZIP instead of being dropped.
- Low-confidence photos are clearly separated or marked for review.
- No original file is moved unless the user explicitly confirms the move plan.
- Core demo path completes without using the map preview.

## 9. Open Questions

- Should the MVP implement true original-file movement using File System Access API, or should original move wait for the desktop auxiliary path?
- Resolved: rename the product from `Pindrop` to `TripSort` to emphasize automatic travel photo sorting over map pins.
- Resolved: default output uses `Trip_<date-range>_<place>/YYYY-MM-DD_<place>/<filename>`.
- Resolved: VLM can create normal place folders only with accepted confidence; low/unavailable results fall back to `Unknown Location`.
