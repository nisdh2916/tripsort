# Pindrop 개발 일지

**날짜:** 2026-04-30  
**브랜치:** `claude/photo-travel-review-ai-wigIr`

---

## 프로젝트 배경

생성형 AI 활용 서비스 과제 (2주). 여러 아이디어 중 **사진 → 여행 후기 생성기**에서 출발해 **Pindrop**으로 발전.

초기 아이디어 snaplog (Flask + Ollama + 바닐라 JS, EXIF GPS → SNS 후기 자동 생성)에서 방향 전환.  
교수님 추천 + 지도 핀 아이디어 → 3D 지구본으로 발전.

---

## 핵심 차별점

> **ChatGPT·Claude는 EXIF를 읽지 않는다.**  
> Pindrop은 exifr.js로 직접 파싱 → 3D 지구본 핀 + 로컬 Vision LLM 태그.

---

## 기술 결정 사항

| 항목 | 결정 | 이유 |
|------|------|------|
| Vision AI | Ollama (llama3.2-vision) | 무료·무제한, RTX 5070으로 충분 |
| 3D 지구본 | Globe.gl | Three.js 기반 무료, 핀·Arc·HTML레이어 내장 |
| EXIF 파싱 | exifr.js (클라이언트) | 서버 전송 전 로컬 처리 |
| 역지오코딩 | OpenStreetMap Nominatim | 무료, API 키 불필요 |
| 백엔드 | Python Flask | 경량, Ollama HTTP API 호출에 충분 |
| 벡터 검색 | ChromaDB + CLIP | 자연어 검색 예정 |

---

## 구현 히스토리

### Phase 1 — 뼈대
- `index.html` 레이아웃 (사이드바 + 지구본)
- Flask `/upload` 엔드포인트
- Globe.gl 3D 지구본 초기화
- exifr.js EXIF 파싱

### Phase 2 — 핵심 파이프라인
- EXIF GPS → Nominatim 역지오코딩 → 지구본 핀
- 핀 클릭 팝업 (사진·지명·좌표·날짜)
- 사이드바 핀 목록

### Phase 3 — Vision AI
- Flask `/tag` → Ollama llama3.2-vision 호출
- Base64 인코딩 이미지 전달
- 10개 카테고리 JSON 응답 파싱
- 태그별 핀 색상 (음식→주황, 풍경→초록 등)

### Phase 4 — 완성도
- 반응형 레이아웃 (680px 이하 모바일)
- 팝업 닫기 버튼 + 클릭 위치 기반 동적 위치
- 분석 중 pulse 애니메이션
- XSS 방지 (escapeHtml)

### 추가 기능
- **세션 유지**: 서버 `pins.json` 저장 → 새로고침 후 복원
- **핀 삭제**: 사이드바 ✕ / 팝업 🗑
- **태그 필터**: 카테고리별 필터 칩
- **JSON 내보내기**: 전체 핀 데이터 다운로드
- **Arc 여행 경로**: 날짜순 핀 연결 애니메이션 호선
- **라이트박스**: 팝업 이미지 클릭 → 전체화면
- **통계 패널**: 핀 수·지역 수·태그 분포 바 차트
- **✈ 여행 재생**: 대권(Great Circle) 경로 비행기 애니메이션, 날짜순 순회

---

## 유사 서비스 조사 결과

| 서비스 | EXIF | 지도 | AI 태그 | 로컬 | 3D |
|--------|:----:|:----:|:-------:|:----:|:--:|
| Google Photos | ✓ | 2D | ✓ | ✗ | ✗ |
| PhotoPrism | ✓ | 2D | ✓ | ✓ | ✗ |
| Immich | ✓ | 2D | ✓ | ✓ | ✗ |
| LibrePhotos | ✓ | 2D | ✓ | ✓ | ✗ |
| TravelGlobe | ✓ | 3D | ✓ | ? | ✓ |
| **Pindrop** | ✓ | **3D** | ✓ | ✓ | ✓ |

- PhotoPrism: places365 고정 모델, 카테고리 변경 불가
- Pindrop: Ollama 프롬프트만 수정하면 카테고리 자유롭게 변경 가능

---

## 예정 기능

### 자연어 검색 (RAG 2-pass)

**Forward (인덱싱):**
```
사진 업로드 → CLIP Image Encoder → 이미지 벡터
메타데이터 텍스트화 → CLIP Text Encoder → 메타데이터 벡터
→ ChromaDB 저장
```

**Backward (검색):**
```
쿼리 입력 → CLIP Text Embedding → ChromaDB Top-K 검색
→ Ollama LLM 재랭킹 → 지구본 핀 하이라이트
```

필요 패키지: `chromadb`, `sentence-transformers`

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/upload` | 사진 파일 업로드 (최대 30MB) |
| POST | `/tag` | Vision AI 태그 분류 |
| GET | `/pins` | 저장된 핀 목록 조회 |
| POST | `/pins` | 핀 메타데이터 저장 (upsert) |
| DELETE | `/pins/<id>` | 핀 삭제 |
| POST | `/search` | 자연어 검색 (예정) |
| POST | `/index` | CLIP 인덱싱 (예정) |
