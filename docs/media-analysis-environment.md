# FFmpeg·FFprobe Linux 검증 환경

Docker Desktop의 Linux 엔진으로 전체 테스트와 미디어 검사를 실행한다. Windows 의존성이나 실행 정책을 변경하지 않고 별도의 소스 스냅샷·Linux 의존성을 사용한다.

## 실행

Docker Desktop의 Linux 엔진과 Git이 필요하다. REA 분석까지 하려면 현재 앱의 `out/` 빌드도 준비한다.

```powershell
# 이미지 빌드, 미디어 회귀 검사, 전체 테스트, 데스크톱·모바일 타입 검사
.\scripts\verify-media-analysis.ps1

# 준비된 이미지 사용
.\scripts\verify-media-analysis.ps1 -SkipBuild

# 현재 out/의 선택적 REA 분석 포함
.\scripts\verify-media-analysis.ps1 -SkipBuild -AnalyzeEditor
```

`npm run verify:media-analysis`도 같은 진입점이다. 검증 소스는 **현재 커밋 HEAD**의 `git archive`이므로 변경을 커밋한 뒤 실행한다. OpenCut도 별도 스냅샷으로 포함한다. 루트·모바일 lockfile로 의존성을 설치하며 npm 설치 스크립트는 실행하지 않는다.

이미지 정의는 `scripts/media-analysis/`에 있다. 프로젝트를 `/input`에 읽기 전용 연결하고 컨테이너 내부 `/work/project`에서 검사한다. 기존 Windows `node_modules`는 사용하지 않는다. 결과는 `.local-runtimes/linux-verification/`에 기록한다. 선택적 분석 단계는 네트워크 없이 실행한다.

## Windows 앱의 자동 출력 검사

위 절차로 `openscene-media-analysis:local` 이미지를 준비하고 Docker Desktop을 실행한다. 앱은 Docker를 시작하거나 이미지를 다운로드·빌드하지 않는다.

기본은 네이티브 FFprobe다. Windows에서 시작하지 못하면 준비된 Linux 컨테이너를 시도한다. 명시적으로 Linux를 선택하려면 앱 실행 전에 설정한다.

```powershell
$env:VIDEO_TOOL_FFPROBE_RUNTIME = 'linux-container'
npm run dev
```

메인 프로세스가 출력 파일 하나만 읽기 전용으로 연결한다. 컨테이너는 네트워크·추가 capability·쓰기 가능한 루트 파일시스템 없이 실행하며 30초 제한과 1MB 출력 제한을 사용한다. 컨테이너 메타데이터 검사도 같은 경로를 쓴다.

측정값은 타임라인의 예상 길이·크기·프레임레이트·오디오 존재와 대조한다. 컨테이너 검사 성공 시 결과에 `Verified with Linux FFprobe.`가 표시된다. 검사 불가는 검증 성공이 아니며, 렌더링 완료와 review를 구분해 표시한다. 단순 스트림 메타데이터 검사는 모든 오디오 동기·화면 품질을 보장하지 않으므로 프레임·음성 검사도 수행한다.

## 결과 읽기

- `vitest.json`: 개별 테스트 결과와 통계.
- `full-tests.log`, `previously-failed-tests.log`: 전체 실행과 미디어 회귀 검사 로그.
- `npm-ci.log`, `mobile-npm-ci.log`: 의존성 준비 결과.
- `tool-versions.txt`, `image-id.txt`: 실행 환경 식별자.
- `block-output-probe.json`, `block-look.json`, `block-contact-sheet.png`: 선택적 로컬 QA 파일 검사.
- REA 결과: [자체 빌드 분석 가이드](rea-editor-evidence.md) 참조.

스크립트는 `.local-runtimes/block-workflow-result.mp4`가 있을 때만 그 파일의 probe와 프레임 시트를 만든다. 최신 캔버스 결과처럼 다른 로컬 출력은 별도의 probe/look 실행으로 확인해야 한다. 다른 체크아웃에 없는 QA 파일을 검사한 것으로 보고하지 않는다.

최근 기록은 [캔버스·내보내기 검증](canvas-export-verification.md)에 리비전과 함께 관리한다. `88c6ecf`에서는 1,191개 테스트가 실패·건너뜀 없이 통과했다. 모바일 타입 검사는 포함되지만 실기기 검증은 별도다.
