# TripSort 개발 일지 (DEVLOG)

> Historical note: 이 문서는 초기 `Pindrop` 지도/핀 아이디어에서 현재 `TripSort` 여행 사진 정리 제품으로 방향이 바뀐 과정을 남긴 기록이다. 아래의 `Pindrop`, 지구본, 지도 중심 표현은 당시 맥락을 설명하는 역사적 내용이며, 현재 제품 방향은 `TripSort`의 여행/날짜/장소 기반 파일 정리와 byte-preserving ZIP export다.

**브랜치:** `claude/photo-travel-review-ai-wigIr`  
**기간:** 2026-04-30 ~  
**과목:** 생성형 AI 활용 서비스 (2주 과제)

---

## 1. 프로젝트 탄생 배경

### 아이디어 변천사

| 단계 | 이름 | 내용 |
|------|------|------|
| 1차 | snaplog | 여행 사진 → EXIF GPS → SNS 후기 자동 생성 (Flask + Ollama) |
| 2차 | 방향 전환 | "GPT로 대체 가능하지 않냐" 고민 → 교수님 추천: 사진 분류·정리 |
| 3차 | **Pindrop** | 지도 핀 아이디어 → 3D 지구본으로 발전 |

### 핵심 차별점

> **ChatGPT·Claude는 EXIF를 읽지 않는다.**  
> Pindrop은 exifr.js로 직접 파싱 → 3D 지구본 핀 + 로컬 Vision LLM 태그.

---

## 2. 공부한 내용

### Vision AI 동작 원리
- 사진을 패치로 쪼개 → 특징 추출 → 숫자 벡터 변환
- 사진끼리 비교하는 게 아니라 **특징을 뽑아내는 것**
- 브랜드/장소 세부 인식은 로고·텍스트 없으면 구분 못함

### 이미지 관련 AI 기술 종류

| 기술 | 역할 |
|------|------|
| OCR | 사진 속 글자 읽기 |
| 이미지 캡셔닝 | 사진 객관 묘사 |
| VQA | 사진에 질문/답변 |
| 이미지 검색 (CLIP) | 비슷한 사진 찾기 |
| VLM / Vision LLM | 사진 이해 + 자유로운 글 생성 |

### VLM 구조
```
사진 → Vision Encoder → Projection Layer → LLM → 텍스트
```

### EXIF 메타데이터
- 사진 파일 속 GPS, 촬영일시, 카메라 정보
- GPS 좌표 → Nominatim API(무료) → 실제 지명 변환
- ChatGPT/Claude는 EXIF를 읽지 않음 → **차별점**

---

## 3. 기술 스택 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| Vision AI | Ollama (llama3.2-vision) | 무료·무제한, RTX 5070으로 충분 |
| 3D 지구본 | Globe.gl | Three.js 기반 무료, 핀·Arc·HTML레이어 내장 |
| EXIF 파싱 | exifr.js (클라이언트) | 서버 전송 전 로컬 처리 |
| 역지오코딩 | OpenStreetMap Nominatim | 무료, API 키 불필요 |
| 백엔드 | Python Flask | 경량, Ollama HTTP API 호출에 충분 |
| 벡터 DB | ChromaDB | 자연어 검색용 (예정) |
| 임베딩 | CLIP (sentence-transformers) | 이미지+텍스트 동일 벡터 공간 |
| 하드웨어 | RTX 5070 8GB / RAM 32GB | Ollama GPU 추론 |

---

## 4. 데이터 흐름

```
사진 업로드
    ↓
exifr.js → GPS 좌표 + 촬영일시 (클라이언트)
    ↓
Nominatim → 실제 지명 변환
    ↓
Flask /upload → 서버 저장
    ↓
Globe.gl → 3D 지구본에 핀 배치 + flyTo
    ↓ (백그라운드)
Flask /tag → Ollama llama3.2-vision → 10개 카테고리 태그
    ↓
Flask /pins → pins.json 저장 (세션 유지)
    ↓ (예정)
Flask /index → CLIP 임베딩 → ChromaDB 저장
```

---

## 5. 구현 히스토리

### Phase 1 — 뼈대 구축
- `index.html` 레이아웃 (사이드바 + 지구본)
- Flask `/upload` 엔드포인트
- Globe.gl 3D 지구본 초기화 (Blue Marble 텍스처)
- exifr.js EXIF 파싱

### Phase 2 — 핵심 파이프라인
- EXIF GPS → Nominatim 역지오코딩 → 지구본 핀
- 핀 클릭 팝업 (사진·지명·좌표·날짜)
- 사이드바 핀 목록 (최신순)

### Phase 3 — Vision AI 태그
- Flask `/tag` → Ollama llama3.2-vision 호출
- Base64 인코딩 이미지 전달
- 10개 카테고리 JSON 응답 파싱
- 태그별 핀 색상 차별화

**태그-색상 매핑**

| 태그 | 색상 |
|------|------|
| 음식 | 주황 #f97316 |
| 풍경 | 초록 #22c55e |
| 인물 | 보라 #a78bfa |
| 건축 | 노랑 #facc15 |
| 자연 | 민트 #34d399 |
| 도시 | 파랑 #60a5fa |
| 교통 | 회색 #94a3b8 |
| 동물 | 분홍 #f472b6 |
| 실내 | 연보라 #c084fc |
| 야경 | 남색 #818cf8 |

### Phase 4 — 완성도
- 반응형 레이아웃 (680px 이하 모바일, 사이드바 토글)
- 팝업 닫기 버튼 + 클릭 위치 기반 동적 위치
- 분석 중 pulse 애니메이션
- XSS 방지 (escapeHtml)
- uploads/.gitkeep, pins.json gitignore

### 추가 기능

| 기능 | 설명 |
|------|------|
| 세션 유지 | 서버 `pins.json` 저장 → 새로고침 후 복원 |
| 핀 삭제 | 사이드바 ✕ 호버 버튼 / 팝업 🗑 버튼 |
| 태그 필터 | 카테고리별 필터 칩 (태그 생기면 자동 등장) |
| JSON 내보내기 | 전체 핀 데이터 `pindrop-YYYY-MM-DD.json` 다운로드 |
| Arc 여행 경로 | 날짜순 핀 연결 애니메이션 호선 (토글) |
| 라이트박스 | 팝업 이미지 클릭 → 전체화면 확대 (ESC 닫기) |
| 통계 패널 | 핀 수·지역 수·태그 분포 바 차트 |
| 전체 보기 | 모든 핀 중심으로 카메라 이동 |
| ✈ 여행 재생 | 대권 경로 비행기 애니메이션, 날짜순 순회 |

---

## 6. ✈ 비행기 애니메이션 상세

```
재생 버튼 클릭
    ↓
핀을 날짜순 정렬
    ↓
1번 핀으로 카메라 이동 + 팝업 표시
    ↓
Great Circle SLERP 보간으로 ✈ 이동
고도: MAX_ALT × sin(t × π)  ← 이륙·순항·착륙 포물선
거리에 비례한 비행 시간 (최소 2초 ~ 최대 8초)
✈ 방위각 계산으로 이모지 회전
    ↓
도착 → 카메라 flyTo + 팝업 + 사이드바 하이라이트
    ↓
2.2초 대기 후 다음 구간
    ↓
전체 완료 → 토스트 알림
```

---

## 7. 유사 서비스 조사

### 전체 비교

| 서비스 | EXIF | 지도 | AI 태그 | 로컬 처리 | 3D 지구본 |
|--------|:----:|:----:|:-------:|:--------:|:--------:|
| Google Photos | ✓ | 2D | ✓ | ✗ 클라우드 | ✗ |
| Apple Photos | ✓ | 2D | ✓ | ✓ | ✗ |
| PhotoPrism | ✓ | 2D | ✓ | ✓ | ✗ |
| Immich | ✓ | 2D | ✓ | ✓ | ✗ |
| LibrePhotos | ✓ | 2D | ✓ | ✓ | ✗ |
| TravelGlobe | ✓ | 3D | ✓ | 불명확 | ✓ |
| **Pindrop** | ✓ | **3D** | ✓ | **✓** | **✓** |

### 사진 자동 분류 비교

| 서비스 | 모델 | 커스터마이징 |
|--------|------|------------|
| Google Photos | 자체 AI | ✗ |
| PhotoPrism | places365 (고정) | ✗ |
| LibrePhotos | places365 (고정) | ✗ |
| Immich | CLIP 기반 | ✗ |
| **Pindrop** | llama3.2-vision | **✓ 프롬프트 수정으로 카테고리 자유롭게 변경** |

### LibrePhotos vs PhotoPrism

| | LibrePhotos | PhotoPrism |
|--|------------|------------|
| 라이선스 | MIT 완전 무료 | AGPL + 유료 멤버십 |
| 운영 | 커뮤니티 | 베를린 팀 (상업적) |
| 지도 | 2D MapLibre | 2D (6종 고해상도) |
| AI | places365 + im2txt | 자체 ML 파이프라인 |
| Pindrop 대비 | 3D 없음 | 3D 없음 |

### 자연어 검색 현황

CLIP 기반 자연어 검색은 Immich·PhotoPrism 등에서 이미 제공.  
하지만 기존 서비스는 검색 결과를 **그리드**로 표시.  
Pindrop은 검색 결과를 **3D 지구본에서 핀 하이라이트**로 연결 — 차별점.

---

## 8. 자연어 검색 설계 (RAG 2-pass)

### 핵심 기술: CLIP

텍스트와 이미지를 **같은 벡터 공간**에 매핑.
- `"저녁에 먹은 라멘"` → 텍스트 벡터
- 사진들의 이미지 벡터와 코사인 유사도 비교 → 가장 유사한 사진 반환

### Forward Pass — 인덱싱 (업로드 시)

```
사진 업로드
    ↓
CLIP Image Encoder → 이미지 벡터 (512차원)
    +
메타데이터 텍스트화
  "장소: 서울, 날짜: 2024년 7월, 태그: [도시, 건축]"
    → CLIP Text Encoder → 메타데이터 벡터
    ↓
ChromaDB에 저장
  (이미지 벡터 + 메타데이터 + pin_id)
```

### Backward Pass — 검색 (쿼리 시)

```
사용자 입력: "저녁에 먹은 라멘"
    ↓
1단계: CLIP Text Encoder → 쿼리 벡터
       ChromaDB 코사인 유사도 검색 → Top-K 후보
    ↓
2단계: 후보 사진 + 쿼리 → Ollama LLM 재랭킹
       "이 사진이 쿼리에 해당하나요? Yes/No"
    ↓
최종 결과 → 지구본 핀 하이라이트 + 사이드바 필터
```

### 기존 서비스와의 차이

| | PhotoPrism / Immich | **Pindrop** |
|--|-------------------|------------|
| 검색 방식 | CLIP 1-pass | **CLIP + LLM 2-pass RAG** |
| 메타데이터 활용 | 제한적 | **GPS·날짜·태그 통합** |
| 결과 표시 | 그리드 | **3D 지구본 핀 하이라이트** |
| 재랭킹 | ✗ | **Ollama LLM 재랭킹** |

### 필요 패키지

```bash
pip install chromadb sentence-transformers pillow
```

---

## 9. API 엔드포인트 현황

| 메서드 | 경로 | 상태 | 설명 |
|--------|------|:----:|------|
| POST | `/upload` | ✅ | 사진 파일 업로드 (최대 30MB) |
| POST | `/tag` | ✅ | Vision AI 태그 분류 |
| GET | `/pins` | ✅ | 저장된 핀 목록 조회 |
| POST | `/pins` | ✅ | 핀 메타데이터 저장 (upsert) |
| DELETE | `/pins/<id>` | ✅ | 핀 삭제 |
| POST | `/index` | 🔲 | CLIP 이미지 인덱싱 |
| POST | `/search` | 🔲 | 자연어 검색 (RAG 2-pass) |

---

## 10. 프로젝트 구조

```
pindrop/
├── app.py              # Flask 백엔드
├── index.html          # 메인 페이지
├── requirements.txt
├── .gitignore
├── README.md           # 프로젝트 소개
├── REQUIREMENTS.md     # 요구사항 명세서
├── PLAN.md             # 구현 계획 체크리스트
├── DEVLOG.md           # 개발 일지 (이 파일)
├── uploads/            # 업로드 사진 (git 제외)
├── pins.json           # 핀 메타데이터 (git 제외, 자동 생성)
└── static/
    ├── css/style.css   # 다크 테마 전체 스타일
    └── js/
        ├── exif.js     # EXIF 파싱 (exifr.js 래퍼)
        ├── globe.js    # Globe.gl 핀·Arc·투어 관리
        └── main.js     # 전체 파이프라인 진입점
```

---

## 11. 실행 방법

```bash
# 1. Ollama 모델 준비
ollama pull llama3.2-vision

# 2. 의존성 설치
pip install -r requirements.txt

# 3. 서버 실행
python app.py

# 4. 접속
# http://localhost:5000
```

---

## 12. 주의사항

- Nominatim rate limit: 초당 1요청 → 다중 업로드 시 1.1초 간격 자동 적용
- Ollama 첫 모델 로딩 시간 있음 (llama3.2-vision ≈ 7GB)
- GPS 없는 사진(스크린샷, SNS 저장 이미지)은 핀 배치 불가
- ChromaDB 인덱싱은 Ollama와 별개로 sentence-transformers 필요
