# TripSort 발표 구성 초안

이 문서는 TripSort 발표 PPT를 만들기 위한 목차와 슬라이드 구성안이다.

발표의 핵심 메시지는 다음 한 문장으로 잡는다.

> TripSort는 여행 사진을 단순히 보여주는 서비스가 아니라, EXIF/GPS/VLM signal과 사용자의 수동 보정을 결합해 검토 가능한 여행별 폴더 구조와 byte-preserving ZIP 결과물을 만드는 서비스다.

## 발표 목표

- 서비스가 해결하는 문제를 명확히 설명한다.
- TripSort가 어떤 방식으로 사진을 정리하는지 보여준다.
- VLM을 어떻게 사용했는지, 그리고 왜 VLM에게 최종 판단을 전부 맡기지 않았는지 설명한다.
- 개발 과정에서 사용한 기술과 Agent/Codex skill 활용 방식을 보여준다.
- 테스트와 검증, 남은 한계를 솔직하게 정리한다.

## 전체 목차

1. 표지
2. 문제 정의
3. 서비스 소개
4. 핵심 사용자 흐름
5. Before / After
6. 주요 기능
7. 기술 아키텍처
8. VLM 활용 방식
9. 여행 자동 분리 로직
10. 수동 보정 UX
11. 개발 과정
12. 개발에 사용한 Agent/Codex 스킬
13. 테스트와 검증
14. 차별점
15. 한계와 개선 방향
16. 데모 시나리오

## 슬라이드별 구성

### 1. 표지

**제목**

TripSort

**부제**

여행 사진 자동 정리 서비스

**넣을 내용**

- 이름
- 날짜
- 과목/프로젝트명
- 한 줄 설명: `사진을 넣으면 여행/날짜/장소 기준 폴더 구조를 제안하고 ZIP으로 내보내는 서비스`

### 2. 문제 정의

**핵심 메시지**

여행 후 사진은 많고, 사진마다 메타데이터 품질이 달라서 수동 정리가 번거롭다.

**내용**

- 여행 사진이 한 폴더에 뒤섞인다.
- EXIF 날짜/GPS가 있는 사진과 없는 사진이 섞인다.
- 카카오톡/인스타 저장본, 스크린샷, 다운로드 이미지에는 GPS가 없거나 EXIF가 깨져 있을 수 있다.
- 수동으로 여행별/날짜별/장소별 폴더를 만드는 작업은 시간이 많이 걸린다.

**시각 자료 아이디어**

```text
Before
IMG_0012.jpg
IMG_2031.jpg
KakaoTalk_20260501.jpg
Screenshot_20260502.png
download_abc.webp
```

### 3. 서비스 소개

**핵심 메시지**

TripSort는 여행 사진을 검토 가능한 폴더 구조로 정리하고, 원본 품질을 유지한 ZIP 결과물을 만든다.

**내용**

- 사진 업로드
- EXIF/GPS/VLM 분석
- 여행 그룹 자동 생성
- 폴더 구조 preview
- 사용자가 수정
- ZIP export

**한 줄 소개**

> 자동 정리 + 사람이 검토 가능한 수정 + 원본 byte 보존 export

### 4. 핵심 사용자 흐름

**흐름**

```text
사진 업로드
  -> EXIF 날짜/GPS 추출
  -> GPS reverse geocode 또는 VLM 장소 추론
  -> VLM trip signal 추출
  -> 여행 그룹 자동 분리
  -> 사용자가 merge/split/edit
  -> ZIP 다운로드
```

**발표 포인트**

- 지도는 중심 기능이 아니라 GPS 사진 확인용 보조 preview다.
- 최종 결과물은 정리된 ZIP이다.

### 5. Before / After

**Before**

```text
photo_dump/
  IMG_0012.jpg
  IMG_2031.jpg
  KakaoTalk_20260501.jpg
  Screenshot_20260502.png
```

**After**

```text
Jeju Spring 2026/
  2026-05-01_Jeju City/
    IMG_0012.jpg
  2026-05-02_Seogwipo/
    KakaoTalk_20260501.jpg

Trip_2026-05-10_Tokyo/
  2026-05-10_Tokyo/
    IMG_2031.jpg
```

**강조**

- 사용자가 폴더명을 수정할 수 있다.
- 자동 분리가 틀리면 합치거나 나눌 수 있다.

### 6. 주요 기능

**기능 목록**

- JPG/JPEG/PNG/HEIC/WEBP 가져오기
- EXIF 촬영일/GPS 추출
- GPS reverse geocoding
- GPS 없는 사진의 VLM 장소 추론
- VLM trip signal 추출: `city`, `country`, `landmark`, `sceneType`
- 여행 자동 분리
- 수동 보정: `Merge previous`, `Split here`
- 여행명/날짜/장소/파일명 수정
- preview와 동일한 ZIP export
- 원본 이미지 byte 보존

### 7. 기술 아키텍처

**서비스에 사용된 기술**

| 영역 | 기술 |
| --- | --- |
| Frontend | HTML, CSS, Vanilla JavaScript |
| Backend | Python Flask |
| EXIF parsing | exifr.js |
| GPS reverse geocoding | OpenStreetMap Nominatim |
| VLM | Ollama `llama3.2-vision` |
| Search/embedding support | CLIP, ChromaDB |
| Map preview | MapLibre / MapTiler |
| Desktop auxiliary run | Electron |
| Test | Python unittest, Node checks, Playwright e2e |

**아키텍처 그림**

```text
Browser
  |-- EXIF/date/GPS extraction
  |-- organization preview
  |-- manual edits
  |
Flask backend
  |-- upload storage
  |-- reverse geocode proxy
  |-- VLM inference
  |-- preview/export path generation
  |
Ollama
  |-- llama3.2-vision
```

### 8. VLM 활용 방식

**핵심 메시지**

VLM에게 최종 정렬을 전부 맡기지 않고, 정렬에 필요한 신호만 추출했다.

**VLM이 하는 일**

```json
{
  "place": "N Seoul Tower",
  "city": "Seoul",
  "country": "South Korea",
  "landmark": "N Seoul Tower",
  "sceneType": "city skyline",
  "confidence": "medium",
  "reason": "Visible tower and city skyline."
}
```

**VLM을 최종 판단자로 쓰지 않은 이유**

- 촬영 날짜를 안정적으로 알 수 없다.
- 비슷한 음식/호텔/거리 사진은 오판 가능성이 있다.
- 결과가 매번 달라질 수 있다.
- 테스트 가능한 deterministic 로직이 필요하다.

**현재 설계**

```text
VLM signal
  + EXIF date
  + GPS/reverse geocode
  + user correction
  -> deterministic trip scoring
```

### 9. 여행 자동 분리 로직

**핵심 메시지**

날짜 gap만 쓰지 않고, VLM trip signal을 함께 점수화한다.

**현재 scoring**

| 조건 | 점수 |
| --- | ---: |
| 촬영일 gap > 3일 | +4 |
| country signal 변경 | +5 |
| city signal 변경 | +3 |
| city/country가 모두 같음 | -4 |

```text
score >= 4 -> 새 여행으로 분리
```

**예시 1: 날짜 gap은 작지만 국가가 다름**

```text
2026-05-01 Seoul, South Korea
2026-05-02 Tokyo, Japan
```

결과: 다른 여행으로 분리

**예시 2: 날짜 gap은 크지만 도시/국가가 같음**

```text
2026-05-01 Seoul, South Korea
2026-05-08 Seoul, South Korea
```

결과: 같은 여행으로 유지

### 10. 수동 보정 UX

**핵심 메시지**

자동 분리는 틀릴 수 있으므로, 사용자가 final control을 가져야 한다.

**수동 보정 기능**

- `Merge previous`: 현재 여행을 이전 여행과 합치기
- `Split here`: 해당 사진부터 새 여행으로 나누기
- 여행 폴더명 직접 수정
- 날짜/장소/파일명 직접 수정

**데이터 모델**

```json
{
  "organization": {
    "tripGroupId": "manual-trip-..."
  }
}
```

**설명**

`tripGroupId`가 있으면 자동 scoring보다 우선한다. 따라서 preview와 ZIP export 모두 사용자의 수동 보정을 따른다.

### 11. 개발 과정

**과정 요약**

1. 초기 아이디어: Pindrop, 지도/핀 중심 여행 사진 시각화
2. 문제 재정의: 지도보다 중요한 것은 사진 파일 정리 결과물
3. 제품명 변경: Pindrop -> TripSort
4. 핵심 구조 변경: 지도 preview 중심 -> trip/date/place folder preview 중심
5. VLM 활용 범위 재정의: 최종 판단자가 아니라 trip signal extractor
6. 수동 보정 추가: 자동화의 실패를 제품 UX 안에서 복구 가능하게 설계

**발표 포인트**

- 개발 중 제품 방향이 바뀌었다.
- 방향 전환을 문서와 테스트에 반영했다.
- 기능 구현보다 “제품 약속”을 다시 잡은 것이 중요했다.

### 12. 개발에 사용한 Agent/Codex 스킬

**핵심 메시지**

이번 개발은 단순 코드 생성이 아니라, Agent skill과 검증 루프를 사용해 요구사항을 점진적으로 구체화했다.

#### 12.1 사용한 주요 스킬: `tdd`

**왜 사용했나**

- 사용자가 “TDD로 테스트하면서 완성형으로 만들자”고 요청했다.
- 여행 분리, ZIP export, manual override는 회귀 위험이 큰 로직이다.
- 그래서 public interface 기준 테스트를 먼저 만들고 구현했다.

**적용 방식**

```text
RED: 실패하는 테스트 추가
GREEN: 최소 구현
REFACTOR: 중복/문서/경계 정리
```

**실제 적용 예**

- backend `/organization/preview` 테스트
  - 날짜 gap으로 여행이 나뉘는지
  - trip signal로 여행이 나뉘는지
  - 같은 city/country signal이면 긴 날짜 gap도 유지되는지
  - `tripGroupId`가 자동 scoring을 override하는지
- browser e2e 테스트
  - 여행명 수정이 저장되는지
  - 자동 분리 preview가 맞는지
  - `Merge previous`가 같은 `tripGroupId`를 저장하는지
  - `Split here`가 다른 `tripGroupId`를 저장하는지

#### 12.2 AGENTS.md / Karpathy-style 지침 활용

프로젝트 루트의 `AGENTS.md` 지침을 작업 원칙으로 사용했다.

주요 적용:

- 모호한 요구사항을 바로 코드로 고정하지 않고, 기능 단위로 쪼갰다.
- 과도한 추상화보다 현재 문제를 해결하는 최소 구현을 우선했다.
- 관련 없는 리팩터링을 섞지 않고, 기능과 문서 변경을 분리했다.
- 검증 가능한 결과를 기준으로 작업을 닫았다.

#### 12.3 문서화/정리 흐름

별도 PRD skill을 호출하지는 않았지만, PRD/ADR/README/기술 문서를 계속 업데이트하는 방식으로 진행했다.

정리한 문서:

- `README.md`: 현재 사용법과 핵심 기능
- `REQUIREMENTS.md`: 현재 기능 요구사항
- `docs/tripsort-sorting-flow.md`: 정렬 기술 흐름
- `docs/tripsort-trip-signal-scoring.md`: VLM signal + scoring 설계
- `PLAN.md`: 현재 구현 상태와 남은 우선순위
- historical PRD: 과거 Korea-map 방향임을 명시

#### 12.4 검증 자동화

개발 과정에서 사용한 검증:

```powershell
python -m unittest discover -s tests
npm run check:js
npm run test:unit
npm run test:e2e
npm run test:demo
git diff --check
```

**발표에서 강조할 점**

> AI coding agent를 단순히 코드를 빠르게 쓰는 도구로 쓴 것이 아니라, 테스트-문서-구현 루프를 유지하는 개발 파트너로 사용했다.

### 13. 테스트와 검증

**검증 항목**

- Python backend unit/integration tests
- JS syntax checks
- frontend e2e smoke test
- real photo demo test
- ZIP byte preservation
- VLM unavailable fallback
- manual merge/split persistence

**검증 예시**

```text
python -m unittest discover -s tests
npm run test:e2e
npm run test:demo
```

**테스트 결과를 보여주는 방식**

- 터미널 캡처 1장
- “82 tests 통과” 같은 숫자
- e2e에서 검증한 핵심 시나리오 목록

### 14. 차별점

**TripSort의 차별점**

- 단순 사진 뷰어가 아니라 정리 결과물을 만든다.
- GPS 없는 사진도 정리 flow에 포함한다.
- VLM을 최종 판단자가 아니라 설명 가능한 signal extractor로 사용한다.
- 자동 결과를 사용자가 merge/split으로 고칠 수 있다.
- ZIP export에서 이미지 byte를 보존한다.
- 지도는 보조 preview로 낮추고, 파일 정리를 제품 중심에 둔다.

### 15. 한계와 개선 방향

**현재 한계**

- 실제 대량 사진 세트로 scoring 튜닝이 더 필요하다.
- 자동 분리 이유가 UI에 아직 충분히 드러나지 않는다.
- `Merge previous`, `Split here`, `Save` 같은 문구가 아직 개발자스럽다.
- 자동 grouping으로 되돌리기 버튼이 필요하다.
- 배포 패키징은 현재 PC 외 환경에서 추가 검증이 필요하다.

**다음 단계**

- 실사진 50~200장 테스트
- split reason 표시
- 자동 분리로 되돌리기
- 버튼 문구 한국어화
- 데모용 샘플 사진 세트 준비
- Electron packaging 재검증

### 16. 데모 시나리오

**권장 데모 흐름**

1. 여러 여행 사진을 업로드한다.
2. 자동으로 여행 폴더가 나뉘는 preview를 보여준다.
3. GPS 없는 사진이 VLM으로 장소 후보를 받는 흐름을 설명한다.
4. 자동 분리가 틀린 예시를 `Merge previous` 또는 `Split here`로 수정한다.
5. 여행 폴더명을 수정한다.
6. ZIP export를 실행한다.
7. ZIP 안의 폴더 구조를 보여준다.

## 발표 시간이 짧을 경우 추천 슬라이드

### 5분 발표

총 6장 추천.

1. 표지
2. 문제 정의
3. 서비스 소개 + 핵심 흐름
4. VLM + trip scoring 핵심
5. 개발 과정과 TDD/Agent skill 활용
6. 데모 또는 결과/한계

**버릴 수 있는 내용**

- 상세 아키텍처 표
- 테스트 명령 전체 목록
- 세부 scoring 예시 2개 중 하나

### 7분 발표

총 8장 추천.

1. 표지
2. 문제 정의
3. 서비스 소개
4. Before / After
5. 기술 아키텍처
6. VLM 활용 + 여행 분리 로직
7. Agent skill / TDD 개발 과정
8. 테스트/한계/데모

### 10분 발표

총 10장 추천.

1. 표지
2. 문제 정의
3. 서비스 소개
4. 사용자 흐름
5. Before / After
6. 기술 아키텍처
7. VLM signal + scoring
8. 수동 보정 UX
9. Agent skill / TDD / 테스트
10. 한계와 개선 방향 + 데모

### 15분 발표

전체 14~16장 사용 가능.

추천:

- 전체 목차를 거의 그대로 사용
- 데모를 3~4분 확보
- Agent skill 활용을 별도 섹션으로 충분히 설명
- 테스트 결과와 문서화 과정을 보여주면 개발 과정의 신뢰도가 올라간다.

## 발표에서 꼭 말하면 좋은 문장

- “TripSort는 사진을 보여주는 서비스가 아니라, 사용자가 가져갈 수 있는 정리 결과물을 만드는 서비스입니다.”
- “VLM에게 최종 정렬을 맡기지 않고, city/country/landmark 같은 signal만 추출했습니다.”
- “최종 여행 분리는 deterministic scoring으로 처리해서 테스트 가능하게 만들었습니다.”
- “자동화가 틀릴 수 있기 때문에 Merge/Split 수동 보정을 제품 flow 안에 넣었습니다.”
- “TDD skill을 사용해 실패 테스트를 먼저 만들고, preview/export가 같은 결과를 내도록 검증했습니다.”

## PPT 제작 팁

- 기술 설명은 코드보다 흐름도로 보여준다.
- VLM 활용은 JSON 예시 하나면 충분하다.
- 테스트는 명령어 전체보다 “무엇을 보장했는지” 중심으로 설명한다.
- 지도 이미지는 너무 크게 쓰지 않는다. 현재 제품 중심은 지도보다 파일 정리다.
- 데모가 가능하면 마지막에 ZIP 폴더 구조를 직접 보여주는 것이 가장 설득력 있다.
