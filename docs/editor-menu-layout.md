# 편집기 메뉴와 작업 공간

OpenScene은 Timeline, 노드 Canvas, Assistant가 같은 프로젝트를 편집한다. 프로젝트를 열면 편집 화면으로 들어가며, 작업 바에서 Timeline과 Canvas를 전환한다.

## 메뉴 트리

```text
애플리케이션 바
├─ Windows: File / Edit / Clip / View / Timeline / Workspace / Help
├─ 열린 프로젝트 탭 / 프로젝트 목록 / 설정 / 뒤로
└─ Assistant: 대화 패널 열기·접기

프로젝트 작업 바
├─ Timeline / Canvas
├─ Project: 프로젝트 설정 / 저장
├─ View: 미디어·Inspector 표시 / 레이아웃 초기화
├─ Appearance: 색상 프리셋 / Light·Dark
├─ Save: 저장 안 된 변경 표시
└─ Export: 프레임·자막·메타데이터 설정 / MP4 진행·결과

Timeline
├─ 왼쪽: Project / Media / Audio / Text
├─ 중앙 위: Program Monitor / 재생·프레임 이동 / 보기 옵션
├─ 오른쪽: Properties / Asset 정보
│  ├─ Edit: 분할 / 앞뒤 트림 / 복제·삭제 / 시작·끝 / 배속 / 전환
│  ├─ Video: 색상 / 위치·크기·회전 / 불투명도 / Reset
│  ├─ Audio: 볼륨 / 원본 오디오 분리 / Reset
│  └─ Text: 제목·자막 / 폰트·굵기·그림자·외곽선·배경 / 위치·길이
└─ 아래: 편집 도구 / 시간 눈금 / 비디오·오디오 트랙

Canvas
├─ 왼쪽 라이브러리
│  ├─ Quick starts: 하이라이트 / 영상+음악 / 화면 속 화면 / 음성+음악
│  ├─ Blocks: 검색 / Video·Audio·Compose·Edit / 12종 블록
│  └─ Sources: 검색 / Import media / 소스 클립 추가
├─ 작업 바: 최종 출력 / Apply workflow / Review timeline / Undo·Redo
│  └─ Auto arrange / Fit / Zoom / Refresh inputs
├─ 정렬 바: 선택 수 / 흐름·격자·정렬·간격 / Arrange nodes / 선택 해제
├─ 중앙: 소스 카드 / 블록·설정 / 타입별 연결선 / 입력 드롭다운
└─ 아래: 연결·적용 상태와 오류 안내
```

Windows 커스텀 메뉴는 앱의 색상·타이포그래피를 사용한다. F10 또는 Alt+F/E/C/V/T/W/H로 열고 방향키로 탐색한다. Escape는 메뉴 버튼으로 포커스를 돌린다. 명령은 기존 편집 컨트롤러의 활성·체크 상태를 공유한다. 텍스트 입력 중에는 OS의 텍스트 편집 명령을 사용한다.

macOS는 시스템 메뉴를 유지한다. Windows의 네이티브 메뉴 바는 숨기고 단축키 등록을 유지한다. Canvas에서는 Timeline 전용 패널 토글이 비활성화된다. OS 창 메뉴는 모바일에 적용하지 않는다.

## 작업 흐름

Canvas는 빠른 시작과 입력 드롭다운으로 연결을 만들 수 있다. 입력과 출력의 타입이 맞지 않거나 순환을 만드는 연결은 거부한다. 블록에 설정값과 계산된 길이·준비 상태를 표시한다.

**Apply workflow**는 선택한 최종 결과를 타임라인에 반영한다. **Review timeline**에서 검토한 뒤 저장·내보내기한다. 설정 변경이나 노드 정렬만으로 영상이 자동 렌더링되지는 않는다. 처리한 입력은 보존하며 **Refresh inputs**로 현재 타임라인을 새 입력으로 삼을 수 있다.

**Auto arrange**는 전체 흐름을 입력→출력 순서로 배치한다. **Arrange nodes**는 선택한 소스·블록에 흐름, 격자, 왼쪽·위쪽 정렬, 가로·세로 간격 맞춤을 적용한다. 선택이 없으면 전체에 적용한다. 좌표는 프로젝트에 저장되며 Undo/Redo로 복구한다. 자세한 규칙은 [캔버스 가이드](canvas-workflows.md)를 따른다.

Timeline은 미리보기·트랙·Inspector의 조절 경계를 유지한다. 미리보기 재생 컨트롤은 프레임 아래 고정 행에 두고, 작업 영역은 창의 남는 높이를 사용한다. Assistant 표시와 폭 등 기존 설정을 유지한다.

## 모바일과 검증

모바일 Canvas는 Templates / Workflow / Sources / Blocks 구획과 공유 블록·정렬 명령을 제공한다. 자유 카드 드래그와 Fit은 데스크톱 전용이며, 모바일 정렬은 데스크톱에서도 사용할 저장 좌표를 변경한다. 모바일 채팅의 프레임·음성 분석도 데스크톱 기능으로 구분한다.

실제 앱 검증 범위는 [편집·내보내기 검증](canvas-export-verification.md)에 기록한다. 메뉴·IPC 분석 절차는 [빌드 분석](rea-editor-evidence.md)을 따른다.
