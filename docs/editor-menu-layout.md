# 편집기 메뉴와 작업 공간

2026-11-21. 목표는 기능 탐색과 작업 공간 조작을 분리하고, Timeline과 Canvas가 같은 프로젝트를 편집한다는 관계를 명확히 하는 것이다.

## 조사 근거

- [ComfyUI 작업 공간 안내](https://docs.comfy.org/interface/overview): 왼쪽 라이브러리, 중앙 그래프, 선택 대상의 보조 패널, 별도의 캔버스 조작 기능을 참고했다.
- [Concat](https://github.com/jub0t/Concat)과 공개 편집 화면: 미디어·미리보기·속성·멀티트랙 편집을 구분하는 전통적 편집기 구성을 참고했다. Concat 코드나 디자인 자산은 가져오지 않았다.
- [REA 조사 기록](rea-editor-evidence.md): 스킬과 CLI를 실제 사용했으나 Windows 정책이 네이티브 모듈을 차단했다. REA의 의미 분석 결과를 확보한 것으로 주장하지 않는다. 현재 화면에 대한 관찰은 소스 읽기와 Electron 실행 검증에 근거한다.

## 구현된 메뉴 트리

```text
애플리케이션 바
├─ 열린 프로젝트 탭 / 프로젝트 목록 / 설정 / 뒤로
└─ Assistant: 대화 패널 열기·접기

프로젝트 작업 바
├─ Timeline / Canvas
├─ Project
│  ├─ Project settings
│  └─ Save project
├─ View
│  ├─ Media library: Timeline에서 표시·숨김
│  ├─ Inspector: Timeline에서 표시·숨김
│  └─ Reset layout
├─ Appearance
│  ├─ Color preset
│  └─ Light / Dark
├─ Save: 저장 안 된 변경 표시
└─ Export: 프레임·자막·메타데이터 설정과 MP4 실행·진행·결과

Timeline
├─ 왼쪽: Project / Media / Audio / Text
├─ 중앙 위: Program Monitor / 재생·프레임 이동 / 보기 옵션
├─ 오른쪽: Selection / Asset Inspector
└─ 아래: 편집 도구 / 시간 눈금 / 비디오·오디오 트랙

Canvas
├─ 왼쪽 라이브러리
│  ├─ Blocks: 검색 / Video / Audio / Compose
│  └─ Sources: 검색 / Import media / 소스 클립 추가
├─ 중앙: 소스 카드 / 기능 블록 / 타입별 연결선
├─ 작업 공간 조작: Undo / Redo / Auto arrange / Fit / Zoom
└─ 아래: 연결 상태 / 적용 안내 / 연결 취소

네이티브 메뉴
├─ File / Edit / View: OS 기본 명령
├─ Timeline: 재생 / 되돌리기 / 자르기 / 트랙 추가 / 저장
└─ Workspace
   ├─ Panels
   ├─ Inspector Placement
   ├─ Floating Panels
   ├─ Presets
   └─ Reset Layout
```

메뉴는 키보드로 열 수 있고 Escape 또는 바깥 클릭으로 닫힌다. Canvas에서는 Timeline 전용 패널 토글이 비활성화된다. 새 사용자의 Assistant는 기본으로 접히며, 기존 사용자의 표시 여부·너비 설정은 유지한다.

## 배치와 상호작용

Canvas에서는 기존 미디어 도크를 중복으로 띄우지 않는다. 라이브러리는 216px, 나머지 영역은 그래프가 차지한다. 블록에는 종류·설명·입출력 포트·계산된 길이·적용 버튼이 보인다. 자동 정렬은 소스 → 처리 → 합성의 의존 순서로 배치하고, Fit은 현재 보이는 영역에 맞춰 축소한다. 직접 드래그와 스크롤도 유지한다.

Timeline은 위쪽 미리보기와 아래쪽 트랙의 기존 조절 경계를 유지한다. 미리보기 재생 컨트롤은 별도의 고정 행에 두어 화면 크기를 바꿔도 프레임 아래로 잘리지 않게 한다. 프로젝트 작업 영역은 창의 남는 높이를 채운다.

모바일 Canvas는 Workflow / Sources / Blocks 구획을 제공한다. Blocks에서 검색 가능한 동일한 카탈로그와 설명을 사용하고, Workflow에서 연결·적용한다. 자유 위치 배치와 Fit은 데스크톱 전용이다. 모바일 실기기 검증은 이번 Windows 환경에서 수행하지 못했으며 타입 검사를 수행한다.

## 경계

이 변경은 작업 공간과 탐색 구조를 재구성한다. 블록 실행은 기존 공유 편집 규칙과 타임라인을 사용한다. 그래프가 원본 파일을 덮어쓰거나 자동으로 렌더링하지 않으며, 최종 블록 적용 후 Timeline에서 검토하고 저장한 결과를 Export로 내보낸다.
