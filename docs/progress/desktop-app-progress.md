# TripSort Desktop App Progress

작성일: 2026-05-13

## 현재 방향

TripSort의 1차 제품 형태는 PC 브라우저 기반 여행 사진 정리 workflow다. Electron은 같은 Flask 웹앱을 로컬 데스크톱 창으로 여는 보조 실행 방식이다.

Electron은 별도 제품이 아니다. 사용자가 `python app.py`를 직접 실행하지 않아도 같은 TripSort UI를 열 수 있게 하는 convenience path다.

## 현재 구현 상태

- `desktop/main.cjs`로 Electron 보조 실행 제공
- `npm run desktop` 명령 제공
- Electron 실행 시 Flask 서버 자동 시작
- 서버 readiness check는 Ollama를 기다리지 않는 `/ping` 사용
- 앱 identity:
  - npm package: `tripsort`
  - Electron `productName`: `TripSort`
  - Electron `appId`: `local.tripsort.app`
- local AI:
  - Vision/place/trip signal: Ollama `llama3.2-vision`
  - search rerank: Ollama `llama3.2`
  - 모델은 앱에 번들하지 않고 사용자 로컬 Ollama 설치를 호출

## 현재 TripSort 기능과 데스크톱 관계

데스크톱 실행은 다음 웹 기능을 그대로 제공한다.

- 사진 가져오기
- EXIF 날짜/GPS 추출
- GPS reverse geocoding
- GPS 없는 사진의 VLM 장소 추론
- VLM trip signal 추출
- 여행 자동 분리와 수동 merge/split 보정
- 정리 preview
- byte-preserving ZIP export
- GPS 사진용 지도 미리보기

## 검증 기록

최근 기능 검증 기준:

- `python -m py_compile app.py tests/test_app.py`: 통과
- `python -m unittest discover -s tests`: 통과
- `npm run check:js`: 통과
- `npm run test:unit`: 통과
- `npm run test:e2e`: 통과
- `npm run test:demo`: 통과
- `git diff --check`: 통과, Windows CRLF 경고만 있음

## 남은 확인 포인트

- `npm run desktop`를 현재 TripSort UI 기준으로 다시 수동 확인
- `npm run pack` / `npm run dist` 산출물 이름이 TripSort로 생성되는지 확인
- 새 PC에서 README 절차만으로 실행 가능한지 확인
- Ollama 모델이 없을 때도 preview/ZIP export가 막히지 않는지 실제 환경에서 재확인

## 주의 사항

- `.venv`를 포함한 패키징은 현재 PC 기준 실행에는 유리하지만, 다른 PC 배포까지 완전히 보장하지는 않는다.
- 진짜 배포판에서는 Python runtime bundling 또는 PyInstaller 기반 backend packaging을 별도로 검토해야 한다.
- `llama3.2-vision`은 용량이 커서 첫 설치 시간이 걸릴 수 있다.
- 원본 파일 이동은 ZIP export와 분리된 안전 기능이어야 하며, 자동 실행하면 안 된다.
