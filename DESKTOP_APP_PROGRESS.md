# Pindrop Desktop App Progress

작성일: 2026-05-03

## 목표

Pindrop 웹 서비스를 무료 로컬 AI 기반으로 실행하고, Electron을 보조 실행 방식으로 제공한다.

## 현재 방향

- Pindrop의 1차 제품 형태는 PC 브라우저 기준 웹 서비스로 둔다.
- Electron으로 기존 Flask 웹앱을 데스크톱 창에서 여는 보조 실행 방식을 유지한다.
- Flask 서버는 Electron 실행 시 자동으로 시작한다.
- AI는 클라우드 API 없이 로컬 Ollama를 사용한다.
- 사진 태그·캡션은 `llama3.2-vision`을 사용한다.
- 검색 재정렬은 `llama3.2`를 사용한다.
- Ollama와 모델 파일은 앱 설치 파일에 포함하지 않고, 사용자의 로컬 Ollama 설치를 호출한다.

## 완료

- Electron 실행기 추가: `desktop/main.cjs`
- 데스크톱 실행 명령 추가: `npm run desktop`
- AI 상태 패널 추가
- `llama3.2-vision` 누락 시 태그·캡션 호출을 건너뛰도록 처리
- 패키징 설정 초안 추가: `npm run pack`, `npm run dist`
- 브라우저 smoke 테스트에 AI 상태 패널 검증 추가

## 현재 상태

- 로컬 실행 준비 완료
- Ollama 필수 모델 준비 완료
- Windows 설치 파일 생성 완료
- 설치 없이 실행 가능한 데스크톱 보조 실행 확인 완료
- 설치 파일 자체는 아직 실행하지 않음
- 데스크톱 실행 시작 실패 수정 완료
- LAN 바인딩 지원 추가. 휴대폰 브라우저 접속은 현재 1차 범위 밖이며 향후 보조 가능성으로 둠

## 최근 진행

- `electron-builder` 설치 완료: `electron-builder@26.8.1`
- `llama3.2-vision:latest` 다운로드 완료
- `/health` 기준 필수 모델 상태:
  - `llama3.2`: 사용 가능
  - `llama3.2-vision`: 사용 가능
- 첫 `npm run pack` 시도 결과:
  - 실패 원인: `package.json`에 `version` 누락
  - 조치: `version`, `description`, `author` 메타데이터 추가
- 두 번째 `npm run pack` 시도 결과:
  - 실패 원인: Windows 코드서명 도구 캐시 압축 해제 중 symlink 권한 부족
  - 조치: 로컬 dry run용으로 `win.signAndEditExecutable=false` 설정
- 세 번째 `npm run pack` 시도 결과:
  - 성공
  - 산출물: `dist/win-unpacked/Pindrop.exe`
- `npm run dist` 결과:
  - 성공
  - 설치 파일: `dist/Pindrop Setup 0.1.0.exe`
  - 설치 파일 크기: 약 275 MB
  - 전체 `dist` 폴더 크기: 약 1.43 GB
- `/health` 최종 확인:
  - Ollama: 연결됨
  - `llama3.2`: 사용 가능
  - `llama3.2-vision`: 사용 가능
- 설치 없이 실행 확인:
  - 실행 파일: `dist/win-unpacked/Pindrop.exe`
  - 프로세스 상태: 응답 중
- 데스크톱 실행 시작 실패 분석:
  - 원인: Electron이 `/health`를 1초 안에 확인하려고 했지만, `/health`는 Ollama 모델 상태까지 조회해서 느릴 수 있음
  - 영향: 이미 Flask가 떠 있어도 Electron이 서버 없음으로 오판하고, 같은 5000 포트에 Flask를 다시 띄우려다 실패
  - 조치: Ollama를 조회하지 않는 `/ping` endpoint를 추가하고 Electron readiness check를 `/ping`으로 변경
- 수정 후 재검증:
  - `npm run pack`: 성공
  - `npm run dist`: 성공
  - 재생성된 `dist/win-unpacked/Pindrop.exe`: 실행 성공
  - `http://127.0.0.1:5000/ping`: 정상
  - `http://127.0.0.1:5000/health`: Ollama 및 필수 모델 정상
- LAN 접속 준비:
  - Flask 실행 host를 `PINDROP_HOST`로 설정 가능하게 변경
  - Electron 실행 시 기본 `PINDROP_HOST=127.0.0.1`로 백엔드 시작
  - LAN 접속이 필요할 때만 명시적으로 `PINDROP_HOST=0.0.0.0`을 설정
  - 프론트 API 주소를 고정 `localhost` 대신 현재 접속 origin 기준으로 변경
  - 현재 PC IP: `192.168.55.9`
  - 같은 네트워크의 다른 기기에서 확인할 주소 예: `http://192.168.55.9:5000`
  - 휴대폰 브라우저 접속은 현재 1차 범위가 아니므로 별도 UX 검증 대상에서 제외
- 이전 LAN 접속 준비 후 재검증:
  - `python -m unittest discover -s tests`: 통과
  - `python -m py_compile app.py tests/test_app.py`: 통과
  - `npm run check:js`: 통과
  - `npm run test:e2e`: 통과
  - `npm run pack`: 성공
  - `npm run dist`: 성공
  - 재생성된 `dist/win-unpacked/Pindrop.exe`: 실행 성공
  - 당시 백엔드 리스닝 주소: `0.0.0.0:5000`
  - `http://127.0.0.1:5000/ping`: 정상
  - `http://192.168.55.9:5000/ping`: 정상

## 검증 기록

- `python -m unittest discover -s tests`: 통과
- `python -m py_compile app.py tests/test_app.py`: 통과
- `npm run check:js`: 통과
- `npm run test:unit`: 통과
- `npm run test:e2e`: 통과
- `npm run test:demo`: 통과
- Korea map smoke: 대한민국 지도 렌더링, 국내 핀 배치, 해외 목록 분리, scope/tag/date/search 조합, 삭제, 내보내기 확인
- Real-photo demo: 실제 GPS fixture 업로드 후 대한민국 지도 핀 투영과 graceful search unavailable 상태 확인
- `dist/win-unpacked/Pindrop.exe`: 실행 확인
- 인앱 브라우저에서 `http://localhost:5000/` 렌더링 확인
- 인앱 브라우저에서 AI 상태 패널 확인:
  - Ollama: 연결됨
  - 사진 태그·캡션: 사용 가능
  - 검색 재정렬: 사용 가능
  - 콘솔 에러 없음

## 주의 사항

- `.venv`를 포함한 패키징은 현재 PC 기준 실행에는 유리하지만, 다른 PC 배포까지 완전히 보장하지는 않는다.
- 진짜 배포판에서는 Python 런타임 번들링 또는 PyInstaller 기반 백엔드 패키징을 별도로 검토해야 한다.
- `llama3.2-vision`은 용량이 커서 다운로드 시간이 걸릴 수 있다.
- 생성된 설치 파일은 아직 실행 검증하지 않았다. 설치 파일 실행은 로컬 시스템에 앱을 설치하는 작업이므로 별도 확인 후 진행한다.

## 다음 확인 포인트

- 실제 GPS가 들어 있는 사진으로 업로드 동작 확인
- 사진 태그·캡션 생성 결과 확인
- 검색어 입력 시 로컬 재정렬 결과 확인
- 설치 파일 실행 후 시작 메뉴/바탕화면 앱 실행 확인
