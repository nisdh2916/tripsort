# TripSort Branch Review

작성일: 2026-05-03

> Historical note: 이 문서는 `Pindrop`에서 `TripSort`로 제품명이 바뀌기 전후의 브랜치 정리 기록이다. 저장소 원격 이름은 아직 `nisdh2916/pindrop`일 수 있지만, 현재 제품명과 사용자-facing 문서는 `TripSort`를 기준으로 한다.

## 확인 범위

- 로컬 기준 브랜치: `main`
- 원격 저장소: `nisdh2916/pindrop`
- 확인 명령: `git fetch --all --prune`, 원격 브랜치 비교, GitHub PR 목록 확인
- 코드 변경 전 작업트리: clean

## 원격 브랜치 상태

| 브랜치 | 상태 | 판단 |
| --- | --- | --- |
| `origin/main` | 현재 기준 | 최신 통합 브랜치 |
| `origin/claude/photo-travel-review-ai-wigIr` | `main`에 병합됨 | PR #1, #2, #3으로 반영됨 |
| `origin/merge/codex-hardening` | `main`에 병합됨 | PR #4로 반영됨. tip 내용은 `main`과 동일 |
| `origin/codex` | 그래프상 미병합 | 최신 기능 브랜치보다 오래된 코드 상태가 많아 그대로 병합하면 회귀 위험이 큼 |

## 브랜치 판단

`origin/codex`에는 hardening, 테스트, CI 관련 커밋이 남아 있지만, 해당 성격의 작업은 `origin/merge/codex-hardening`을 통해 `main`에 다시 구성되어 병합된 상태입니다.

따라서 `origin/codex`를 그대로 `main`에 병합하는 것은 권장하지 않습니다. 필요하다면 파일 단위 또는 커밋 단위로 실제 누락분만 확인한 뒤 cherry-pick해야 합니다.

## 확인된 리스크와 처리

| 항목 | 영향 | 처리 |
| --- | --- | --- |
| AI 캡션 생성 후 벡터 인덱스를 다시 갱신하지 않음 | 캡션 기반 자연어 검색 품질 저하 가능 | 캡션 저장 직후 `/index`를 다시 호출하도록 수정 |
| JSON body가 `null` 또는 object가 아닐 때 `.get()` 호출 | 400 대신 500 응답 가능 | JSON object 전용 helper를 추가해 400으로 처리 |
| 위도 또는 경도가 `0`이면 검색 메타데이터에서 좌표 누락 | 적도/본초자오선 근처 사진 검색 품질 저하 가능 | `None` 여부로 좌표 존재를 판단하도록 수정 |
| 전체 CORS 허용 | 외부 노출 시 API 접근 범위가 과도함 | 기본 허용 origin을 localhost로 제한하고 `PINDROP_CORS_ORIGINS`로 조정 가능하게 수정 |
| `debug=True` 고정 실행 | 외부 노출 시 Flask debug 모드 위험 | `PINDROP_DEBUG=1`일 때만 debug 모드로 실행하도록 수정 |

## 수정 파일

- `docs/reviews/branch-review.md`
- `app.py`
- `static/js/main.js`
- `tests/test_app.py`

## 남은 권장 작업

- `origin/codex` 브랜치는 삭제 전 한 번 더 보관 필요 여부를 확인합니다.
- 배포 환경에서 사용할 origin이 있다면 `PINDROP_CORS_ORIGINS`를 명시합니다.
- 로컬 실행 시 debug 모드가 필요하면 `PINDROP_DEBUG=1`을 지정합니다.
