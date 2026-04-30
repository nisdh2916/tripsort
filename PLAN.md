# Pindrop 구현 계획

## 현재 상태

- [ ] 레포 초기화 완료
- [ ] 구현 없음 (백지 상태)

---

## 구현 우선순위

### Phase 1 — 뼈대 구축 (1~2일)

> 일단 동작하는 것부터. UI 완성도 신경 쓰지 않음.

- [ ] `index.html` 기본 레이아웃 (업로드 영역 + 지구본 영역)
- [ ] `app.py` Flask 기본 구조 (파일 업로드 엔드포인트 `/upload`)
- [ ] Globe.gl CDN으로 3D 지구본 띄우기 (더미 핀 테스트)
- [ ] exifr.js로 EXIF GPS 추출 확인 (콘솔 출력 수준)

### Phase 2 — 핵심 파이프라인 연결 (2~3일)

> EXIF → 지구본 핀까지 end-to-end 연결.

- [ ] 사진 업로드 → Flask 수신 → exifr.js EXIF 파싱
- [ ] GPS 좌표 → Nominatim 역지오코딩 → 지명 반환
- [ ] 지명 + 좌표 → Globe.gl 핀 배치
- [ ] 핀 클릭 → 사진 썸네일 + 지명 팝업

### Phase 3 — Vision AI 태그 (2~3일)

> Ollama 연동. Phase 2가 완성된 후 추가.

- [ ] Flask에서 Ollama API 호출 (`/api/chat`, base64 이미지 전달)
- [ ] 응답 파싱 → 태그 추출 (음식/풍경/인물/건축/자연 등)
- [ ] 태그를 핀 팝업에 표시
- [ ] 태그별 필터링 UI (선택 사항)

### Phase 4 — 완성도 (1~2일)

> 제출 전 마무리.

- [ ] 다중 사진 업로드 지원
- [ ] EXIF 없는 사진 예외 처리 (안내 메시지)
- [ ] 로딩 인디케이터 (Vision AI 처리 중)
- [ ] 기본 반응형 레이아웃
- [ ] README 업데이트 + 스크린샷 추가

---

## 주요 기술 결정 사항

| 항목 | 결정 | 이유 |
|------|------|------|
| Vision AI | Ollama (로컬) | 무료, 무제한, RTX 5070으로 충분 |
| 지구본 | Globe.gl | Three.js 기반 무료 라이브러리, 핀 기능 내장 |
| EXIF 파싱 | exifr.js (프론트) | 서버 전송 전 클라이언트에서 바로 추출 가능 |
| 역지오코딩 | Nominatim | 무료, API 키 불필요 (rate limit 주의: 1 req/s) |
| 백엔드 | Flask | 경량, Ollama HTTP API 호출에 충분 |

## 주의사항

- Nominatim rate limit: 초당 1요청 → 다중 업로드 시 순차 처리 필요
- Ollama 첫 실행 시 모델 로딩 시간 있음 (llama3.2-vision ~7GB)
- EXIF GPS가 없는 사진(스크린샷, 카카오 저장 등)은 핀 배치 불가 → 명확한 안내 필요
- ChatGPT/Claude는 EXIF를 읽지 않으므로 직접 파싱이 핵심 차별점

## 참고 링크

- [Globe.gl 공식 문서](https://globe.gl)
- [exifr.js GitHub](https://github.com/MikeKovarik/exifr)
- [Nominatim API](https://nominatim.org/release-docs/develop/api/Reverse/)
- [Ollama API 문서](https://github.com/ollama/ollama/blob/main/docs/api.md)
