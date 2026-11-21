# REA 기반 편집 화면 조사 기록

조사일: 2026-11-21 (Asia/Seoul). 목적은 영상 편집기의 메뉴 구조와 작업 공간을 재구성할 근거를 남기는 것이다. REA의 관찰, 일반 소스 조사와 설계 판단을 구분한다.

## 최종 결과: Linux 실행과 메뉴 구조 교차 검증

공식 REA **6.10.1**을 실행 가능한 Linux 컨테이너에서 실제 실행했다. Windows Application Control 설정이나 차단된 네이티브 파일은 변경하지 않았다. REA 분석, 메뉴 명령 브리지 추적, 이전·현재 아티팩트 비교가 모두 종료 코드 0으로 완료됐다. **현재 메뉴 트리와 모드별 활성 상태는 실제 Electron 런타임 관찰로 확인했다.** 렌더러 전체의 정적 의미 분석은 아래 자원 한계 때문에 부분적이며, 이 한계를 메뉴 구조 검증 완료와 구분한다.

- 환경: `openscene-media-analysis:local`, Node **24.22.3**, REA **6.10.1**, Linux procps. 이미지 ID `sha256:332e3f703581447a2916d88c6158eb245c120ca29f70dd8a7c6abd52204df314`.
- 입력: 최신 `out/` 복사본 `.local-runtimes/rea-artifact-after/`, 이전 복사본 `.local-runtimes/rea-artifact-before/`.
- 격리: 프로젝트 입력은 읽기 전용 bind, 결과 디렉터리만 쓰기 허용, 분석 컨테이너 네트워크 `none`, 추가 capability 없음. 아티팩트 코드를 실행하거나 외부 서비스로 보내지 않았다.
- 최신 분석 선택: `main/index.js`, `preload/index.cjs`, `renderer/assets/index-BeUwZBPG.js`. 이전 분석은 메뉴·브리지 비교에 필요한 main/preload 두 파일만 선택했다.
- 별도의 실제 앱 관찰: `Menu.getApplicationMenu()`를 재귀 순회한 `native-menu-runtime.json`, Timeline/Canvas의 Project·View·Appearance DOM과 비활성 상태를 수집한 `renderer-menu-runtime.json`. 두 파일은 `.local-runtimes/linux-verification/`에 있다. 이는 REA 정적 Evidence가 아니라 Electron 런타임 관찰이다.

### REA Evidence 원장

| 작업 | Evidence ID / 관찰 |
| --- | --- |
| 최신 아티팩트 분석 | `ev_8a07d0cc0e1554dba015fa1ddd6daf696b3e03f5b5b740310f7656d842e843f0` |
| 최신 아티팩트 SHA-256 | `de76351f27169acd32d121b5816857c6b8727c1cb6888a88802d61836f07bf17` |
| 이전 아티팩트 분석 | `ev_fc05d2ffcf2df3329666262d31cc723c8132363fcb678179cd6fb1410984c6e3` |
| 메뉴 브리지 진입점 추적 | `ev_db7862527eacdf91d668249c4cf64c08c9f6f103c2750426417ca4fbc9da3d67` |
| 이전·현재 정적 비교 | `ev_e04dfc3968e77c5babf04c4bc99acc8c736f53bed33b88197ec1122ddefab11a` |

최신 분석의 원시 통계는 JavaScript 파일 3개 파싱, AST 노드 153,879개 방문, finding 196개다. BrowserWindow 1개, contextBridge API 1개와 노출 멤버 58개, 리터럴 IPC 채널 58개를 관찰했다. **카운트는 보안 보장이나 런타임 도달 가능성 판정이 아니다.** 원본 결과는 `.local-runtimes/rea-linux/after-bundle.json`(약 26.7MB), 이전 결과는 `before-bundle.json`, 추적은 `entry-trace.json`, 비교는 `comparison.json`, 간단한 집계는 `evidence-ledger.json`에 보존했다.

실제 최신 분석 명령:

```text
node /opt/rea/node_modules/rea-agents/scripts/rea.mjs
  analyze-javascript-application /input/.local-runtimes/rea-artifact-after
  --source-path main/index.js --source-path preload/index.cjs
  --source-path renderer/assets/index-BeUwZBPG.js
  --max-semantic-nodes 20000 --max-semantic-nodes-per-file 10000
  --max-heap-mb 2048 --analysis-timeout-ms 120000
  --detail summary --evidence_output /evidence/after-bundle.json --json
```

`trace-application-feature`는 저장된 Evidence bundle을 재사용했다. 채널 문자열에서 outgoing 방향을 조회했을 때는 1개 노드·0개 관계만 반환했으므로 이를 명령 전달 전체 경로로 주장하지 않았다. 반환된 실제 브리지 진입 노드로 범위를 바꿔 다음 **정적 후보 관계**를 확보했다:

```text
videoTool.onTimelineMenuCommand 노출
  → preload closure
  → electron.ipcRenderer.on("timeline-menu:command", subscription)
```

추적 결과는 3개 노드·2개 관계·1개 종단 경로이며, inferred facts 5개, observed runtime facts 0개다. 원본 아티팩트의 `preload/index.cjs:98–105,178` 위치를 보존한다. 진입 노드는 `jag_node_2466f3c0e1b723c83baa759bc64ebbe9e8a92635a61aea7ef81eda336b9bdf69`다. REA는 최신 main의 `createApplicationMenuTemplate` 함수 위치 `main/index.js:267–363`, `dispatchTimelineMenuCommand:254–256`, `installApplicationMenu:374–386`도 기록했다.

### 메뉴 질문별 결론

| 질문 | 근거와 결론 | 상태 |
| --- | --- | --- |
| 편집 명령과 레이아웃 설정이 분리됐는가? | 변경 전 아티팩트/소스의 Timeline→Layout과 달리, 현재 실제 native 트리에 Timeline과 Workspace가 나란히 존재한다. Timeline에는 재생·Undo/Redo·분할·트랙 추가·저장, Workspace에는 Panels / Inspector Placement / Floating Panels / Presets / Reset Layout이 있다. | 확인 |
| 프로젝트·보기·테마 메뉴가 실제 화면에 존재하는가? | renderer DOM에서 Project의 Project settings / Save project, View의 Media library / Inspector / Reset layout, Appearance의 Editor theme preset / 테마 모드 토글을 수집했다. | 확인 |
| 모드에 맞는 메뉴 상태인가? | Timeline에서 Media library와 Inspector 토글 활성, Canvas에서 동일 토글 비활성. 저장되지 않은 변경이 없는 관찰 시점에는 Save project 비활성. | 확인 |
| 기존 좁은 메뉴 브리지 진입점이 남아 있는가? | REA의 contextBridge와 preload 추적에서 `videoTool.onTimelineMenuCommand → ipcRenderer.on` 정적 후보를 확인했다. native 메뉴의 실제 구성도 별도 관찰했다. | 정적 관계 및 메뉴 런타임 구성 확인 |
| REA가 모든 IPC 호출을 연결했는가? | 아니다. 동적 채널/소유권 때문에 renderer transmission 55개가 ambiguous이고 자동 pairing은 0개다. 이 수치를 기능 부재나 명령 전달 실패로 해석하지 않는다. | 전체 호출 그래프는 미확인 |

메뉴 트리의 확정본은 [메뉴·레이아웃 설계](editor-menu-layout.md)에 있다. 이전·현재 REA 비교는 changed 2개, unknown 407개를 반환했다. changed는 artifact/JavaScript asset의 내용·속성 변화이며 메뉴 기능 2개의 변화라는 뜻이 아니다. 양쪽 그래프가 partial이므로 407개를 추가·삭제로 해석하지 않았다. 실제 메뉴 이동 결론은 위의 정적 위치와 현재 런타임 트리 교차 확인에 근거한다.

### 남는 정적 분석 한계

렌더러 번들에서 member-mutation 분석이 파일당 alias state **524,288개** 제한에 도달했다. main의 alias 선택 확장도 보수적으로 제한되고, 의미 노드 보존은 파일당 10,000개다. 전체 그래프의 coverage는 `partial`이며 렌더러 전체 동작·도달 가능성·보안 집행까지 완전히 복원한 것은 아니다. 동일 분석을 무작정 반복하거나 제한을 제거하지 않았다. 필요한 메뉴 범위는 실제 메뉴 열거와 DOM 상태를 함께 확인해 마무리했다.

## 이전 Windows 시도와 실패 기록

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

### Windows REA 결과와 한계

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

## 변경 전 일반 소스 조사로 확인한 메뉴 구조

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

## 검증 범위 밖에 남는 사항

- 전체 렌더러 의미 분석과 모든 IPC 송수신 연결은 부분적이다. 위에서 확인한 메뉴 범위와 구분한다.
- ComfyUI·Concat 자체 실행 및 각 메뉴의 전체 동작은 검증하지 않았다.
- 모바일 타입 검사는 통과했으나 개발 기기에서 화면을 실행한 것은 아니다.
- 블록 연결부터 MP4 출력까지의 실행과 FFprobe 검사는 [내보내기 검증 기록](canvas-export-verification.md) 및 Linux 재검증 기록을 따른다. REA 정적 증거로 영상 출력 성공을 대신 증명하지 않는다.
