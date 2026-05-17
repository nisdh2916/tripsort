![TripSort logo](static/img/tripsort-logo-horizontal.png)

# TripSort

TripSort는 여행 사진을 `여행 -> 날짜/장소 -> 파일` 구조로 정리해 주는 데스크톱 앱입니다. 사진 파일 또는 폴더를 가져오면 EXIF 촬영일, GPS, 역지오코딩, VLM 장소 추론, 파일명/폴더명 힌트를 결합해 정리 후보를 만들고, 사용자는 미리보기에서 결과를 수정한 뒤 ZIP으로 내보낼 수 있습니다.

TripSort의 핵심은 지도 시각화가 아니라 사진 파일 정리입니다. 지도, GPS, AI 태그는 정리를 돕는 보조 정보이며, 최종 결과물은 검토 가능한 폴더 구조와 원본 품질을 유지한 ZIP 파일입니다.

## 핵심 방향

TripSort는 앱을 열었을 때 사진 정리 작업대가 먼저 보이도록 설계되어 있습니다. 사용자는 사진을 가져오고, 여행/날짜/장소 기준으로 만들어진 폴더 구조를 검토한 뒤, 필요한 부분을 직접 수정할 수 있습니다.

지도는 GPS가 있는 사진을 확인하기 위한 보조 탭입니다. MapTiler/MapLibre 기반 지도 자원은 `지도 보기`를 열 때만 사용되므로, 첫 화면은 파일 정리 흐름에 집중합니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 사진 가져오기 | JPG, JPEG, PNG, HEIC, WEBP 파일을 여러 장 가져올 수 있습니다. |
| 폴더 가져오기 | 많은 사진을 폴더 단위로 가져올 수 있습니다. |
| EXIF 분석 | 사진의 촬영일과 GPS 좌표를 읽습니다. |
| 장소 분석 | GPS 좌표를 장소명으로 바꾸고, GPS가 없는 사진은 VLM과 파일 힌트로 보강합니다. |
| 여행 자동 분리 | 가져온 사진을 날짜 간격, 장소 신호, VLM trip signal 기준으로 여행 단위 후보로 나눕니다. |
| 정리 미리보기 | ZIP으로 내보내기 전에 여행명, 날짜, 장소, 파일명, confidence, reason을 확인할 수 있습니다. |
| 수동 보정 | 여행 묶음 병합/분리, 폴더명, 날짜, 장소, 파일명을 사용자가 수정할 수 있습니다. |
| 전체 삭제 | 잘못 가져온 사진을 한 번에 비우고 다시 시작할 수 있습니다. |
| ZIP 다운로드 | 원본 이미지를 리사이즈나 재인코딩 없이 정리된 ZIP으로 내보냅니다. |
| 지도 보기 | GPS가 있는 사진을 지도에서 보조적으로 확인할 수 있습니다. |

## 현재 제품 방향

현재 PRD는 [Travel Photo File Organization MVP](docs/prd/travel-photo-file-organization-mvp.md)에 정리되어 있습니다.

초기에는 지도 중심 서비스 방향도 검토했지만, 현재 방향은 여행 사진 파일 정리와 ZIP 내보내기입니다. 지도는 핵심 화면이 아니라 사진 위치를 확인하는 보조 기능으로 유지합니다.

## 동작 흐름

```text
사진 가져오기
    |
EXIF 분석 -> 촬영일/GPS 추출
    |
장소/날짜 추론
    |-- GPS 있음: 역지오코딩으로 장소명 변환
    |-- GPS 없음: VLM, 파일명, 폴더명 힌트로 보강
    |-- 판단 불가: Unknown Date / Unknown Location
    |
여행 묶음 생성: 가져오기 세션 + 날짜 간격 + 장소 신호
    |
정리 미리보기
    |
사용자 수정
    |
원본 bytes를 유지한 ZIP export + manifest.json
```

## 정렬 모델

TripSort는 사진을 가져온 세션을 하나의 여행 후보로 보고, 다음 기준을 조합해 여행 묶음을 나누거나 유지합니다.

- 촬영일 간격이 3일보다 큰 경우
- VLM이 제공한 도시/국가/trip signal
- GPS 기반 장소 정보
- 파일명과 폴더명 힌트
- 사용자가 미리보기에서 적용한 `Merge previous` / `Split here` 수정값

VLM이 최종 여행 묶음을 직접 확정하지는 않습니다. VLM은 구조화된 보조 신호를 제공하고, 최종 정리 결과는 사용자가 검토하고 수정할 수 있는 미리보기로 제공됩니다.

## ZIP 품질 원칙

ZIP export는 원본 이미지 품질을 유지해야 합니다. 내보내기 과정에서 다음 작업을 하지 않습니다.

- 이미지 리사이즈
- 이미지 디코딩 후 재인코딩
- 파일 포맷 변환
- EXIF 제거
- 썸네일을 원본 대신 저장

테스트에서는 업로드된 원본 파일과 ZIP 내부 파일의 SHA-256 해시를 비교할 수 있도록 설계합니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 프론트엔드 | HTML5, CSS3, Vanilla JavaScript |
| 로컬 백엔드 | Python Flask |
| EXIF 분석 | exifr.js |
| 역지오코딩 | OpenStreetMap Nominatim |
| 상세 지도 | MapTiler, MapLibre |
| Vision AI | Ollama `llama3.2-vision` |
| 데스크톱 앱 | Electron |
| Windows 설치 파일 | electron-builder, NSIS |

## 설치 준비

개발 환경에서 실행하려면 Python 가상환경과 npm 패키지를 설치합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
```

Ollama 기반 AI 보강을 사용하려면 Ollama가 실행 중이어야 하고, `llama3.2-vision` 모델을 사용할 수 있어야 합니다. Ollama가 없어도 기본 사진 정리 흐름은 사용할 수 있습니다.

## 데스크톱 앱 실행

```powershell
npm run desktop
```

이 명령은 TripSort를 Electron 앱 창으로 실행합니다. Flask 서비스는 내부 localhost 포트에서 자동으로 시작되며, 설치 앱에서는 데이터가 실행 파일 옆이 아니라 OS 앱 데이터 폴더에 저장됩니다.

## Windows 설치 파일 만들기

```powershell
npm run dist
```

설치 파일은 다음 경로에 생성됩니다.

```text
dist/TripSort-Setup-0.1.0.exe
```

설치 파일 없이 빠르게 unpacked 앱만 만들고 싶다면 다음 명령을 사용합니다.

```powershell
npm run pack
```

## 브라우저 개발 모드

웹 화면만 직접 디버깅할 때 사용합니다.

```powershell
python app.py
```

실행 후 브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:5000/
```

일반 사용과 제출 시연은 브라우저 개발 모드보다 Electron 데스크톱 앱 실행을 권장합니다.

## MapTiler 키 설정

지도는 보조 기능입니다. 개발 환경에서 상세 지도를 사용하려면 repo 루트의 `.env`에 MapTiler 키를 넣습니다.

```dotenv
PINDROP_MAPTILER_KEY=your-maptiler-key
# PINDROP_MAP_STYLE_URL=https://api.maptiler.com/maps/streets-v2/style.json?key=your-maptiler-key
```

`.env`는 git에 포함하지 않습니다.

설치된 데스크톱 앱은 다음 경로의 설정 파일도 읽습니다.

```text
%APPDATA%\TripSort\.env
```

따라서 설치 앱의 지도 키는 repo나 설치 파일에 넣지 않고 사용자 로컬 설정으로 관리할 수 있습니다.

## 검증

```powershell
python -m py_compile app.py tests/test_app.py
python -m unittest discover -s tests
npm run check:js
npm run test:unit
npm run test:e2e
npm run test:demo
```

브라우저 E2E 테스트는 Playwright Chromium을 사용합니다. 필요하면 다음 명령으로 브라우저를 설치합니다.

```powershell
npx playwright install chromium
```

또는 `PINDROP_CHROMIUM_EXECUTABLE`, `CHROME_BIN` 환경변수로 기존 Chromium 계열 브라우저 경로를 지정할 수 있습니다.

## 제출 문서

제출 관련 문서는 `docs/submission/`에 정리되어 있습니다.

| 파일 | 설명 |
| --- | --- |
| `TripSort_Report.md` | 생성형 AI 활용 프로젝트 보고서 원본 |
| `TripSort_Report.pdf` | 제출용 보고서 PDF |
| `TripSort_Presentation.md` | 발표자료 원고 |
| `TripSort_Presentation.pptx` | 발표자료 PPTX |
| `TripSort_PPT_Edit_Prompt.md` | PPT 직접 수정을 위한 프롬프트 |
| `Generative_AI_Usage.md` | 생성형 AI 활용 기록 |
| `Test_Summary.txt` | 검증 요약 |

최종 제출 ZIP은 다음 경로에 생성됩니다.

```text
C:\Users\Desktop\TripSort_Final_Submission.zip
```

## 프로젝트 구조

```text
tripsort/
|-- app.py
|-- desktop/
|   `-- main.cjs      # Electron 데스크톱 실행기
|-- build/
|   |-- icon.ico      # Windows 설치 파일/앱 아이콘
|   `-- icon.png
|-- docs/
|   |-- project/      # 요구사항, 계획, 컨텍스트 문서
|   |-- prd/          # 현재 PRD와 보관된 PRD
|   |-- submission/   # 제출 문서
|   `-- design-references/
|-- index.html
|-- uploads/          # 임시 업로드 사진, git 제외
|-- pins.json         # 로컬 세션 메타데이터, git 제외
`-- static/
    |-- img/          # TripSort 로고, favicon, 앱 아이콘
    |-- css/style.css
    `-- js/
        |-- exif.js
        |-- scope.js
        |-- globe.js  # 보조 지도 미리보기
        `-- main.js
```

## 주의 사항

- `uploads/`는 임시 앱 저장소이며, 정리된 최종 라이브러리가 아닙니다.
- 설치된 데스크톱 앱은 업로드 파일과 `pins.json`을 Electron `userData` 경로에 저장합니다.
- GPS는 유용하지만 필수는 아닙니다. GPS가 없는 사진도 정리 대상에 남아 있어야 합니다.
- 원본 파일 이동은 사용자가 명시적으로 확인한 경우에만 수행해야 합니다.
- 사용자가 미리보기에서 수정한 여행 묶음은 자동 점수보다 우선합니다.
- VLM 결과는 보조 신호이며, 최종 정답처럼 확정하지 않습니다.
