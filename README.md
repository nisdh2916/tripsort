# Pindrop

PC 브라우저에서 여행 사진에 내장된 EXIF GPS 데이터를 자동 추출하고, Vision AI로 사진을 분류한 뒤, 국내 사진은 대한민국 지도에 표시하고 해외 사진은 별도로 정리하는 웹 서비스.

> ChatGPT·Claude는 EXIF를 읽지 않습니다. 직접 파싱하는 것이 핵심 차별점입니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| EXIF GPS 파싱 | 사진 파일에서 위도·경도·촬영일시 자동 추출 |
| 역지오코딩 | GPS 좌표 → 실제 지명 변환 (OpenStreetMap Nominatim) |
| 대한민국 지도 | 국내 사진 핀 배치 및 클릭 팝업 |
| 국내/해외 분리 | GPS 좌표 기준으로 국내 사진과 해외 사진 구분 |
| 국내 이동수단 | 버스·KTX·SRT·철도·지하철·자동차 중심의 이동 맥락 |
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
대한민국 지도 → 국내 사진 핀 배치
    ↓
해외 사진 → 별도 해외 섹션에 정리
    ↓ (백그라운드)
Flask /tag → Ollama llama3.2-vision → 태그
    ↓
Flask /pins → pins.json 저장 (세션 유지)
```

## 기술 스택

| 역할 | 기술 |
|------|------|
| 프론트엔드 | HTML5 / CSS3 / Vanilla JS |
| 지도 보기 | 대한민국 지도 기본, 기존 Globe.gl은 legacy/보조 world view 후보 |
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

### 4. PC 브라우저에서 접속

```
http://localhost:5000
```

## 글로벌 상세 지도 API

기본 화면은 로컬 대한민국 개요 지도를 사용합니다. 해외 사진까지 실제 지도에서 확인하고 싶을 때만 `상세 지도` 버튼으로 글로벌 상세 지도를 켭니다.

현재 상세 지도 provider는 MapTiler입니다. API 키가 없으면 상세 지도는 로드되지 않고 기본 개요 지도로 안전하게 fallback됩니다.

`.env` 파일을 만들고 키를 넣은 뒤 서버를 다시 시작합니다. `.env`는 git에 포함되지 않습니다.

```dotenv
PINDROP_MAPTILER_KEY=your-maptiler-key
# 선택: style URL을 직접 지정할 때만 사용
# PINDROP_MAP_STYLE_URL=https://api.maptiler.com/maps/streets-v2/style.json?key=your-maptiler-key
```

## 데스크톱 보조 실행

Electron으로 Flask 서버와 브라우저 창을 자동으로 열어 Pindrop 웹 서비스를 쉽게 실행합니다.
Pindrop의 1차 제품 형태는 PC 브라우저 기준 웹 서비스이며, 데스크톱 실행은 보조 방식입니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
npm run desktop
```

Electron 보조 실행은 기본적으로 Flask 백엔드를 `127.0.0.1:5000`에만 바인딩합니다.

## 검증

```powershell
python -m py_compile app.py tests/test_app.py
python -m unittest discover -s tests
npm run check:js
npm run test:unit
npm run test:e2e
npm run test:demo
```

- `npm run test:e2e`: PC 브라우저 기준 Korea map smoke. 국내 핀 배치, 해외 목록 분리, AI 상태, 검색, 삭제, 내보내기 흐름을 확인합니다.
- `npm run test:demo`: 실제 GPS fixture 사진으로 Korea map 업로드 데모 경로를 확인합니다.
- 기존 Globe.gl 검증은 1차 acceptance 경로가 아닙니다. 현재 기본 검증은 대한민국 지도와 국내/해외 분리 흐름입니다.

AI 태그·캡션까지 무료 로컬 방식으로 쓰려면 Ollama 모델을 준비해야 합니다.

```powershell
ollama pull llama3.2
ollama pull llama3.2-vision
```

화면 왼쪽의 AI 상태 패널에서 Ollama 연결 여부와 필요한 모델 누락 여부를 확인할 수 있습니다.

## 휴대폰 브라우저 접속

현재 1차 범위는 PC 브라우저 사용입니다.
휴대폰 브라우저 접속은 향후 보조 가능성으로 남겨두며, 별도 모바일 앱은 만들지 않습니다.

필요하면 PC에서 실행 중인 Flask 서버를 같은 네트워크의 다른 기기에서 열 수 있도록 `PINDROP_HOST=0.0.0.0`으로 실행합니다.

```powershell
$env:PINDROP_HOST='0.0.0.0'
python app.py
```

### 패키징

Windows용 실행 패키지를 만들 때는 Electron Builder를 설치한 뒤 빌드합니다.

```powershell
npm install
npm run pack
```

설치 파일까지 만들려면:

```powershell
npm run dist
```

현재 패키징 설정은 `.venv`를 포함하는 로컬 Windows용 구성입니다. Ollama와 모델 파일은 포함하지 않고, 사용자가 로컬에 설치한 Ollama를 호출합니다.

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
        ├── scope.js    # 국내/해외 분류 및 대한민국 지도 좌표 투영
        ├── globe.js    # 대한민국 SVG 지도, 핀, 국내 경로 렌더링
        └── main.js     # 전체 파이프라인
```

## 주의사항

- Nominatim은 초당 1요청 제한 → 다중 업로드 시 파일 간 1.1초 간격 자동 적용
- Ollama 첫 모델 로딩은 시간이 걸릴 수 있음 (llama3.2-vision ≈ 7GB)
- GPS 정보가 없는 사진(스크린샷, SNS 저장 이미지 등)은 핀 배치 불가
