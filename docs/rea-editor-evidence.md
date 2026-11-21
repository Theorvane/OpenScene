# REA 기반 편집 화면 조사 기록

조사일: 2026-11-21 (Asia/Seoul). 목적은 영상 편집기의 메뉴 구조와 작업 공간을 재구성할 근거를 남기는 것이다. REA의 관찰, 일반 소스 조사와 설계 판단을 구분한다.

## 대상과 도구

- 대상: 변경 전 Electron 빌드 `out/`을 복사한 `.local-runtimes/rea-artifact-before/`. 분석 중 재빌드의 영향을 받지 않도록 복사본을 사용했다.
- REA: 공식 `morluto/rea`의 `reverse-engineer-anything` 스킬과 npm `rea-agents` **6.10.1**. 프로젝트 의존성이나 MCP 설정은 변경하지 않고 `.local-runtimes/rea-runner/`에 격리 설치했다. npm 설치 스크립트는 실행하지 않았다.
- 적용 지침: [REA 스킬](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md), [JavaScript 아티팩트 분석](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/references/javascript-applications.md). 일반 소스 저장소 구조는 `rg`와 소스 읽기로 조사했다. REA는 빌드된 아티팩트에만 실행했다.

실제 실행한 분석 명령의 옵션:

```text
rea analyze-javascript-application <artifact-copy>
  --source-path main/index.js --source-path preload/index.cjs
  --max-semantic-nodes 2000 --max-semantic-nodes-per-file 1000
  --analysis-timeout-ms 45000 --max-heap-mb 1024
  --detail summary --evidence_output <local-evidence-file> --json
```

## REA 결과와 한계

분석 결과는 **실패(`capability_unavailable`)**다. Windows Application Control이 REA 패키지의 검증된 `native/windows/build/rea-windows-x64.node` 로드를 차단했다. REA 오류는 파일이 패키지 manifest와 일치하므로 재설치로 해결되지 않으며, 해당 파일을 허용하는 호스트나 서명된 빌드가 필요하다고 명시한다. 동일 명령 재시도나 운영체제 정책 우회는 하지 않았다.

REA가 오류 안에 반환한 부분 Evidence를 별도 JSON으로 보존했다:

| 항목 | 관찰값 |
| --- | --- |
| Evidence ID | `ev_6a361290bd98da8ca9c23f45c6837ebba6b397e2603859b1d0570977c1bf902b` |
| Artifact root SHA-256 | `ea69185874c41b3477f913ee101c3c4a7c726c4f74c7eb5281f62fcdb4f62d2c` |
| Inventory manifest | `agm_19e8452675d6cb23686e000eff2257f54640730d43a1afd880e6ba6377ff1d93` |
| 관련 파일 / 선택한 소스 | 4 / 2 |
| 파싱한 JavaScript / 방문한 AST 노드 | 0 / 0 |
| 로컬 원본 응답 | `.local-runtimes/rea-summary-before.json` |
| 로컬 부분 Evidence | `.local-runtimes/rea-partial-evidence-before.json` |

`--evidence_output` 파일 발행도 실패하여, 오류의 `details.partial_observation`을 추출해 보존했다. 이 Evidence가 확립하는 것은 아티팩트 inventory와 분석 실패 범위다. 응답의 IPC·창·브리지 발견 수 0은 분석이 수행되지 않은 결과이며 **그 기능이 없다는 뜻이 아니다**. 메뉴 트리나 실행 경로를 REA가 복원했다고 주장하지 않는다. 실제 앱의 재생·편집·내보내기 성공 여부도 이 정적 응답으로 증명되지 않는다.

## 일반 소스 조사로 확인한 기존 메뉴 구조

아래 항목은 REA Evidence가 아니라 저장소 소스를 직접 읽은 관찰이다.

| 근거 | 관찰 | 설계에 주는 의미 |
| --- | --- | --- |
| `src/main/applicationMenu.ts`, `createApplicationMenuTemplate` | Timeline 메뉴 안에 재생, Undo/Redo, 분할, 트랙 추가, Layout, 저장이 함께 있다. Layout 안에는 패널 표시, Inspector 위치, 플로팅 패널과 프리셋이 중첩된다. | 편집 명령과 작업 공간 표시 설정을 분리하고, 화면에서 자주 쓰는 작업에 직접 접근할 수 있게 한다. |
| 변경 전 `TimelineEditor.tsx`와 `editor-header.tsx` | 프로젝트 이름, 테마 프리셋·밝기, 모드, 프로젝트 설정, 저장, 내보내기가 한 헤더에 배치된다. | 모드와 저장·내보내기를 유지하고, 테마·패널 설정은 작업 공간 메뉴로 묶는다. |
| 변경 전 `VideoConnectionCanvas.tsx` | 미디어 선택·추가, 기능 블록 선택·추가, Undo/Redo와 줌이 같은 툴바에 있다. | 미디어와 블록 발견은 왼쪽 탐색 영역으로, 캔버스 조작은 중앙의 작은 컨트롤로 구분한다. |
| `TimelineEditorLeftDock.tsx`, `dockTabs.ts` | Project·Media·Audio·Text 도구가 왼쪽 도크에 있다. Audio는 미디어 필터로 구현된다. | 공통 라이브러리와 편집 목적별 탐색을 명확히 하고, 캔버스에서는 블록 라이브러리를 제공한다. |
| `applicationMenu.ts`, `preload/index.ts` | 메뉴 명령은 타입이 정해진 IPC로 renderer에 전달되고, preload가 좁은 API를 노출한다. | 메뉴 재배치 시 IPC 경계를 유지한다. UI 편의를 위해 파일 경로나 FFmpeg 인자를 renderer에 노출하지 않는다. |

## 참고 제품과 설계 판단

[ComfyUI 공식 인터페이스 문서](https://docs.comfy.org/interface/overview)는 왼쪽 Assets·Node Library, 중앙 Canvas, 선택 항목의 오른쪽 패널, 상단 작업 제어와 캔버스 줌·Fit을 별도 영역으로 설명한다. [Concat 공식 저장소](https://github.com/jub0t/Concat)와 [공식 편집기 이미지](https://github.com/jub0t/Concat/blob/main/assets/editor.png)는 미디어·미리보기·타임라인 배치를 비교하는 참고다. 두 제품을 설치해 실행하거나 REA로 분석한 것은 아니다.

OpenScene에 대한 판단은 이 근거를 바탕으로 한 자체 설계다. 공통 프로젝트 헤더와 Timeline/Canvas 모드는 유지하되, 라이브러리·작업 영역·선택 속성·보조 AI의 역할을 나누고 중앙 편집 면적을 우선한다. 기능 블록은 이름과 설명을 보고 찾게 하고, 자주 쓰지 않는 테마와 패널 설정은 메뉴 안으로 옮긴다. 구체적인 메뉴 트리와 구현 범위는 편집 화면 설계 문서에서 관리한다.

## 확인되지 않은 사항

- REA의 JavaScript 의미 분석, 메뉴/IPC 그래프 복원과 런타임 관찰은 완료되지 않았다.
- ComfyUI·Concat 자체 실행 및 각 메뉴의 전체 동작은 검증하지 않았다.
- 모바일 레이아웃은 별도의 타입 검사 및 개발 기기 검증이 필요하다.
- 블록 연결부터 MP4 출력까지의 실제 실행 결과는 앱 테스트 기록으로 별도 확인해야 한다.
