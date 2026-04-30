# Pindrop

여행 사진에 내장된 EXIF GPS 데이터를 자동 추출하고, Vision AI로 사진을 분류한 뒤, 3D 지구본 위에 핀으로 시각화하는 웹 서비스.

> ChatGPT·Claude는 EXIF를 읽지 않습니다. 직접 파싱하는 것이 핵심 차별점입니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| EXIF GPS 파싱 | 사진 파일에서 위도·경도·촬영일시 자동 추출 |
| 역지오코딩 | GPS 좌표 → 실제 지명 변환 (OpenStreetMap Nominatim) |
| 3D 지구본 | 핀 배치 및 클릭 팝업 (Globe.gl) |
| Vision AI 태그 | 음식·풍경·인물 등 10개 카테고리 자동 분류 (Ollama llama3.2-vision) |
| 세션 유지 | 새로고침해도 핀 데이터 유지 (서버 `pins.json`) |
| 태그 필터 | 카테고리별 핀 필터링 |
| 핀 삭제 | 사이드바 또는 팝업에서 개별 삭제 |
| JSON 내보내기 | 전체 핀 데이터 다운로드 |

## 데이터 흐름

```
사진 업로드
    ↓
exifr.js → GPS 좌표 + 촬영일시 (클라이언트)
    ↓
Nominatim → 실제 지명 변환
    ↓
Flask /upload → 서버 저장
    ↓
Globe.gl → 3D 지구본에 핀 배치
    ↓ (백그라운드)
Flask /tag → Ollama llama3.2-vision → 태그
    ↓
Flask /pins → pins.json 저장 (세션 유지)
```

## 기술 스택

| 역할 | 기술 |
|------|------|
| 프론트엔드 | HTML5 / CSS3 / Vanilla JS |
| 3D 지구본 | Globe.gl (CDN) |
| EXIF 파싱 | exifr.js (CDN, 클라이언트) |
| 역지오코딩 | OpenStreetMap Nominatim (무료) |
| Vision AI | Ollama — llama3.2-vision (로컬) |
| 백엔드 | Python Flask |
| 하드웨어 | RTX 5070 8GB / RAM 32GB |

## 실행 방법

### 1. Ollama 설치 및 모델 다운로드

```bash
# https://ollama.com 에서 설치 후
ollama pull llama3.2-vision
```

### 2. Python 의존성 설치

```bash
pip install -r requirements.txt
```

### 3. Flask 서버 실행

```bash
python app.py
```

### 4. 브라우저에서 접속

```
http://localhost:5000
```

## 지원 파일 형식

JPG / JPEG / PNG / HEIC / WEBP — 최대 30MB

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/upload` | 사진 파일 업로드 |
| POST | `/tag` | Vision AI 태그 분류 |
| GET | `/pins` | 저장된 핀 목록 조회 |
| POST | `/pins` | 핀 메타데이터 저장 |
| DELETE | `/pins/<id>` | 핀 삭제 |

## 프로젝트 구조

```
pindrop/
├── app.py              # Flask 백엔드
├── index.html          # 메인 페이지
├── requirements.txt
├── REQUIREMENTS.md     # 요구사항 명세서
├── PLAN.md             # 구현 계획
├── uploads/            # 업로드 사진 (git 제외)
├── pins.json           # 핀 메타데이터 (git 제외, 자동 생성)
└── static/
    ├── css/style.css
    └── js/
        ├── exif.js     # EXIF 파싱
        ├── globe.js    # Globe.gl 핀 관리
        └── main.js     # 전체 파이프라인
```

## 주의사항

- Nominatim은 초당 1요청 제한 → 다중 업로드 시 파일 간 1.1초 간격 자동 적용
- Ollama 첫 모델 로딩은 시간이 걸릴 수 있음 (llama3.2-vision ≈ 7GB)
- GPS 정보가 없는 사진(스크린샷, SNS 저장 이미지 등)은 핀 배치 불가
