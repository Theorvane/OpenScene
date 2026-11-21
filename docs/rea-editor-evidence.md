# OpenScene 자체 빌드와 메뉴 분석

이 가이드는 OpenScene 빌드 아티팩트의 메뉴·IPC 경계를 확인하는 절차다. 제품 메뉴 구조는 [메뉴와 작업 공간](editor-menu-layout.md), 실제 편집·출력 결과는 [실행 검증](canvas-export-verification.md)에서 관리한다.

## 실행 범위

현재 소스로 `npm run build`를 실행하고 준비된 [Linux 환경](media-analysis-environment.md)에서 다음 명령을 사용한다.

```powershell
.\scripts\verify-media-analysis.ps1 -SkipBuild -AnalyzeEditor
```

분석 스크립트 `scripts/media-analysis/analyze-editor.sh`는 현재 `out/`의 복사본을 대상으로 REA를 실행한다. main/preload와 선택한 renderer 번들의 구조를 분석한다. 원본 빌드를 변경하거나 외부 서비스에 전송하지 않는다. 분석 결과와 Evidence는 Git에서 제외된 로컬 결과 디렉터리에 둔다.

## 실제 앱과 교차 확인

1. Windows 커스텀 메뉴와 macOS 네이티브 메뉴의 명령·체크·활성 상태를 확인한다.
2. Timeline/Canvas에서 Project·View·Appearance의 모드별 동작을 확인한다.
3. 키보드 탐색, Escape, 입력 필드의 텍스트 편집을 확인한다.
4. 메뉴 명령이 기존 컨트롤러와 검증된 IPC 명령으로 연결되는지 확인한다.
5. MCP 실행은 등록된 도구와 해당 입력 스키마로 제한되는지 확인한다.
6. Canvas 입력·블록·정렬·Apply·Undo·저장·출력을 실제 앱에서 확인한다.

정적 분석은 실행 결과를 대신하지 않는다. 선택된 파일·분석 한도·시간 제한을 결과에 함께 기록한다. 전체 renderer의 의미 분석이 제한됐다면 부분 결과로 표시한다. 분석하지 못한 기능의 발견 수가 0이라는 이유로 기능이 없다고 결론내리지 않는다.

Windows 네이티브 분석 모듈이 실행 정책으로 차단되면 정책을 변경하지 않고 준비된 Linux 환경을 사용한다. 이전 실행 기록은 해당 아티팩트에만 적용된다. 이 문서 변경 자체를 새 REA 실행 결과로 보고하지 않는다.
