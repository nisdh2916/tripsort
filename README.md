# Pindrop

여행 사진을 업로드하면 EXIF GPS 데이터를 추출해 3D 지구본에 핀으로 표시하고,
Vision AI가 사진을 자동 분류·태그하는 웹 서비스.

## 핵심 기능

1. **사진 업로드** — 단일/다중 사진 업로드
2. **EXIF 파싱** — GPS 좌표·촬영일시 자동 추출 (exifr.js)
3. **역지오코딩** — 좌표 → 실제 지명 변환 (OpenStreetMap Nominatim)
4. **Vision AI 태그** — 사진 분류 (음식/풍경/인물 등, Ollama llama3.2-vision)
5. **3D 지구본 시각화** — 핀 배치 및 클릭 시 사진·태그 표시 (Globe.gl)

## 기술 스택

| 역할 | 기술 |
|------|------|
| 프론트엔드 | HTML / CSS / Vanilla JS |
| 3D 지구본 | Globe.gl (Three.js 기반) |
| EXIF 추출 | exifr.js |
| 역지오코딩 | OpenStreetMap Nominatim API |
| Vision AI | Ollama (llama3.2-vision, 로컬) |
| 백엔드 | Python Flask |

## 데이터 흐름

```
사진 업로드
    ↓
exifr.js → GPS 좌표 + 촬영일시 추출
    ↓
Nominatim API → 좌표를 실제 지명으로 변환
    ↓
Flask → Ollama (llama3.2-vision) → 분류 태그 생성
    ↓
Globe.gl → 3D 지구본에 핀 배치
    ↓
핀 클릭 → 사진 + 태그 + 지명 팝업 표시
```

## 실행 방법

```bash
# 1. Ollama 실행 및 모델 준비
ollama pull llama3.2-vision

# 2. 백엔드 의존성 설치
pip install flask flask-cors pillow

# 3. 백엔드 서버 실행
python app.py

# 4. 프론트엔드
# index.html을 브라우저에서 직접 열거나 Live Server 사용
```

## 프로젝트 구조 (목표)

```
pindrop/
├── app.py              # Flask 백엔드
├── index.html          # 메인 페이지
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── main.js     # 앱 진입점
│       ├── globe.js    # Globe.gl 초기화 및 핀 관리
│       ├── exif.js     # EXIF 파싱 (exifr.js 래퍼)
│       └── upload.js   # 파일 업로드 처리
└── uploads/            # 업로드된 사진 임시 저장
```
