# Make TripSort Photo File Organization The Primary Product Goal

TripSort는 초기 Pindrop 시절 여행 사진 파일을 정리하려는 목표에서 지도 중심 검토 도구로 방향이 기울었다. 제품 중심을 다시 사진 파일 정리로 재설정한다. 핵심 흐름은 사진 가져오기, 메타데이터 읽기, 검토 가능한 여행/날짜/장소 폴더 구조 제안, 수동 그룹 보정, 정리본 ZIP 생성이다. GPS, 국내/해외 범위, MapTiler 지도, AI 라벨, VLM trip signal은 유용한 보조 맥락이지만 첫 제품 약속을 정의하지 않는다.

**Considered Options**

- Pindrop 시절 지도 우선 제품 방향을 유지하고 파일 정리를 나중의 내보내기 기능으로 다룬다.
- 대한민국 지도 우선 방향을 유지하고 국내 여행 검토를 핵심 제품으로 삼는다.
- 사진 파일 정리를 핵심 제품으로 삼고 지도는 보조 미리보기로 낮춘다.

**Consequences**

다음 PRD는 정리 미리보기, 출력 폴더, 파일명 규칙, 비파괴 복사, 위치 없는 사진 처리, VLM trip signal, 수동 여행 그룹 보정, 내보내기 패키지를 중심으로 다시 작성해야 한다. 프로젝트 이름은 지도 핀 중심의 `Pindrop`에서 여행 사진 자동 정리 중심의 `TripSort`로 변경한다.
