# TripSort 구현 계획

## 현재 상태

- [x] 제품명 전환: `Pindrop` 지도/핀 중심에서 `TripSort` 여행 사진 정리 중심으로 변경
- [x] PC 브라우저 기반 사진 가져오기
- [x] EXIF 날짜/GPS 추출
- [x] GPS 기반 reverse geocoding
- [x] GPS 없는 사진의 VLM 장소 추론
- [x] VLM trip signal 추출: `city`, `country`, `landmark`, `sceneType`
- [x] 여행 자동 묶기: import session `tripId`
- [x] 여행 자동 분리: 날짜 gap + VLM trip signal scoring
- [x] 수동 보정: `Merge previous`, `Split here`, `tripGroupId`
- [x] 여행 폴더명/날짜/장소/파일명 수정
- [x] ZIP export: preview path와 동일한 구조, 원본 bytes 보존
- [x] 지도 미리보기: GPS 사진 확인용 보조 기능
- [x] Electron 보조 실행 경로

## 현재 핵심 구조

```text
Photo import
  -> EXIF/date/GPS extraction
  -> GPS reverse geocode or VLM place inference
  -> trip signal extraction
  -> trip grouping/scoring/manual override
  -> organization preview
  -> byte-preserving ZIP export
```

기본 출력 구조:

```text
Trip_YYYY-MM-DD_to_YYYY-MM-DD_Place/YYYY-MM-DD_Place/filename.ext
```

수동 여행명 예시:

```text
Jeju Spring 2026/2026-05-01_Jeju City/IMG_0001.jpg
```

## 다음 우선순위

### 1. 실사진 검증

- [ ] 실제 여행 사진 50~200장으로 자동 분리 품질 확인
- [ ] GPS 있는 사진과 GPS 없는 사진이 섞인 세트 검증
- [ ] 카카오톡/인스타 저장본, 스크린샷, 다운로드 이미지 검증
- [ ] ZIP 결과 폴더 구조가 사람이 기대하는 결과와 맞는지 확인

### 2. 자동 분리 이유 표시

- [ ] preview에 split reason 표시
- [ ] 예: `date gap > 3 days`, `country changed: South Korea -> Japan`, `same city/country kept together`
- [ ] 수동 보정 후에는 `manual tripGroupId`가 적용됐음을 표시

### 3. 수동 보정 UX 정리

- [ ] 버튼 문구를 한국어 제품 문구로 정리
- [ ] `Merge previous` -> `이전 여행과 합치기`
- [ ] `Split here` -> `여기서 나누기`
- [ ] `Save` -> `저장`
- [ ] 자동 분리로 되돌리기 버튼 추가

### 4. 배포/데모 확인

- [ ] 새 PC 기준 설치/실행 재현
- [ ] `python app.py` 실행 확인
- [ ] `npm run desktop` 실행 확인
- [ ] `npm run pack` / `npm run dist` 산출물 이름이 TripSort로 나오는지 확인
- [ ] README만 보고 실행 가능한지 확인

## 검증 명령

```powershell
python -m py_compile app.py tests/test_app.py
python -m unittest discover -s tests
npm run check:js
npm run test:unit
npm run test:e2e
npm run test:demo
git diff --check
```

## 의도적 비목표

- VLM에게 최종 여행 그룹을 직접 위임하지 않는다.
- VLM으로 촬영 날짜나 여행 기간을 추론하지 않는다.
- 지도 미리보기를 export 필수 단계로 만들지 않는다.
- 원본 파일을 자동으로 이동하지 않는다.
- cloud photo library 동기화는 현재 범위 밖이다.
