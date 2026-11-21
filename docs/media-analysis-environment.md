# FFprobe·REA 재검증 환경

2026-11-21, Asia/Seoul. Windows의 Application Control 설정을 유지하면서 Docker Desktop의 WSL2 Linux 컨테이너에 별도 검증 환경을 구성했다. Windows에서 차단됐던 파일을 수정하거나 보안 정책을 해제하지 않았다.

## 실제 실행 결과

| 검사 | 결과 |
| --- | --- |
| 기존 실패 파일 `clipSpeed.test.ts`, `metadataPrivacyFfmpeg.test.ts` | 21개 테스트 통과 |
| 전체 Vitest | 188개 파일, 1,159개 테스트 통과, 실패 0, 건너뜀 0 |
| 데스크톱 Node / Web 타입 검사 | 통과 |
| 모바일 타입 검사 | 통과 |
| 내보낸 MP4의 실제 FFprobe 검사 | H.264 High, yuv420p, 640×360, 30fps, 189프레임, 6.3초 |
| 오디오 FFprobe 검사 | AAC, 스테레오, 22,050Hz, 6.3초 |
| FFmpeg 스킬 프레임 추출 | 3×2 시트 생성, 글자가 나오는 프레임 육안 확인 |
| REA 빌드 아티팩트 분석·IPC 추적 | 성공, [메뉴 분석 기록](rea-editor-evidence.md) 참조 |

배속 테스트는 4초 소스가 2배속에서 약 2초의 영상·음성으로 출력되는 것을 FFprobe로 검증했다. 메타데이터 테스트는 Privacy Clean 결과에서 title·artist·comment가 제거되고 copyright가 보존되는 것을 실제 컨테이너 태그에서 검증했다. 테스트를 비활성화하거나 기대값을 완화하지 않았다.

## 도구와 격리 범위

- Node **24.22.3**, FFmpeg·FFprobe **7.1.5-0+deb13u1**, REA **6.10.1**.
- 공식 Node Debian Trixie 이미지의 digest를 Dockerfile에 고정했다. FFmpeg·FFprobe·procps·Python은 Debian 패키지로 설치했다.
- 분석 이미지: `openscene-media-analysis:local`. 실행 당시 이미지 ID는 `sha256:332e3f703581447a2916d88c6158eb245c120ca29f70dd8a7c6abd52204df314`.
- 프로젝트는 `/input`에 읽기 전용으로 연결한다. `git archive`로 만든 소스와 OpenCut 스냅샷을 컨테이너 내부 `/work/project`에 풀어 Linux용 의존성을 설치했다. 기존 Windows `node_modules`는 변경하지 않는다.
- npm 설치 스크립트는 실행하지 않는다. 모바일 소스를 읽는 테스트와 타입 검사에 필요한 Expo 의존성도 모바일 lockfile로 별도 설치한다.
- 결과만 `.local-runtimes/linux-verification/`에 기록한다. REA 실행은 네트워크를 끄고, 빌드 아티팩트를 복사해 고정한 후 분석한다. 프로젝트 미디어를 외부 서비스로 전송하지 않는다.

## 재현

Docker Desktop의 Linux 엔진과 Git이 필요하다. REA를 다시 분석하려면 먼저 현재 앱의 `out/` 빌드를 준비한다.

```powershell
# 이미지 구성, 기존 실패 테스트, 전체 테스트, 양쪽 타입 검사, 로컬 QA 출력 검사
.\scripts\verify-media-analysis.ps1

# 위 검사와 현재 out/의 REA 분석까지 실행
.\scripts\verify-media-analysis.ps1 -SkipBuild -AnalyzeEditor
```

`npm run verify:media-analysis`도 같은 진입점이다. 스냅샷은 **현재 커밋 HEAD**를 기준으로 하므로 검증할 변경을 커밋한 뒤 실행한다. 로컬 QA 파일 `.local-runtimes/block-workflow-result.mp4`가 있으면 FFmpeg 스킬의 probe와 프레임 검사도 수행한다. 파일이 없는 다른 체크아웃에서는 테스트·타입 검사만 실행한다.

REA의 새 실행은 결과 디렉터리를 매번 만들어 이전 Evidence를 덮어쓰지 않는다. summary와 progress를 분리하고 전체 Evidence JSON을 보존한다. 메뉴 생성과 IPC 노출 범위를 확인하는 분석이며, 제한된 의미 분석이 애플리케이션 전체의 모든 동작을 증명하는 것은 아니다.

## 결과 파일

- `vitest.json`: 전체 테스트의 개별 결과와 통계.
- `previously-failed-tests.log`: 기존 실패 테스트 2개 파일의 실제 통과 로그.
- `tool-versions.txt`, `image-id.txt`: 실행 환경 식별자.
- `block-output-probe.json`: 실제 MP4의 FFprobe 기반 측정값.
- `block-look.json`, `block-contact-sheet.png`: FFmpeg 스킬의 실행 기록과 추출 프레임.
- `native-menu-runtime.json`, `renderer-menu-runtime.json`: 별도로 실제 Windows Electron 앱에서 수집한 메뉴 트리와 모드별 활성 상태. 이 관찰은 REA 정적 분석과 구분한다.

Linux 검증 초기에 모바일 의존성이 빠진 점과 `git archive`의 Windows 줄바꿈 변환을 발견해 환경 준비 단계에서 바로잡았다. upstream FFmpeg 스킬은 manifest의 원본 바이트를 유지하도록 Git 속성을 명시했다. 검증용으로 소스나 체크섬을 바꾸지 않았다.

Windows 보안 정책은 유지한다. Windows 앱은 기본적으로 네이티브 FFprobe를 먼저 사용하고, 실행할 수 없을 때 준비된 로컬 Linux 컨테이너로 자동 전환한다. 이 Windows 세션에서는 네이티브 검증도 실제 통과했으며, 아래 Linux 선택 설정으로 컨테이너 연결도 별도 검증했다. 모바일 실기기 실행은 이번 환경에서 검증하지 않았다.

## Windows 앱의 자동 검사 연결

Docker Desktop의 Linux 엔진을 실행하고 위 스크립트로 이미지를 준비한다. 앱은 엔진을 시작하거나 이미지를 다운로드·빌드하지 않는다. 기본 경로는 네이티브 FFprobe이며, Windows에서 시작 오류가 나면 `openscene-media-analysis:local`을 호출한다. 직접 Linux 환경을 선택하려면 앱을 시작하기 전에 다음 환경 변수를 지정한다.

```powershell
$env:VIDEO_TOOL_FFPROBE_RUNTIME = 'linux-container'
npm run dev
```

메인 프로세스에서 출력 파일 하나만 읽기 전용으로 연결한다. 컨테이너는 네트워크·권한·쓰기 가능한 루트 파일시스템 없이 실행하며, 30초 제한과 1MB 출력 제한을 둔다. 실패하면 측정하지 못한 결과로 표시하며 검증 성공으로 처리하지 않는다. 완료 상태는 측정값을 기존 타임라인과 대조한 후 `Verified with Linux FFprobe.`를 표시한다. 컨테이너 메타데이터 검사도 같은 실행 경로를 사용한다.

실제 Windows 앱에서 네 종류 블록의 연결·적용·Undo/Redo·저장·다시 열기를 확인했다. 새로 출력한 MP4는 6.3초, 640×360, 스테레오였으며 Linux 검증 결과는 `checked: true`, `ok: true`, `verificationRuntime: linux-container`였다. Chromium 디코딩으로 음성 구간 RMS 0.15989, 무음 구간 0, 원본 대사 구간 0.08712도 확인했다. 쉼표가 들어간 Windows 프로젝트 경로에서도 단일 파일 마운트가 작동했다.
