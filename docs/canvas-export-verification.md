# 블록 편집 → MP4 내보내기 검증

2026-11-21, Windows Electron 앱에서 수행. 로컬 QA 파일을 격리된 테스트 프로젝트로 복사해 실제 UI를 조작했다. 내보내기 API나 렌더러 상태를 성공 응답으로 대체하지 않았다.

## 입력과 작업

- 영상: `orbit-launch.mp4`, 9초, 640×360. 화면 글자와 후반 대사가 있는 로컬 QA 영상.
- 음성: `speech.wav`, PCM WAV, 22,050Hz, 55,105개 샘플, 약 2.499초.
- 영상 클립 두 개: 원본 0–2초, 원본 2–6.3초. Join videos의 입력 순서로 연결.
- 음성 클립 두 개: 동일 WAV의 서로 다른 클립 ID, 각각 원본 0–2초. Join audio와 Mix audio를 각각 연결·적용 검증.
- 최종 연결: `Join videos → Video + audio ← Mix audio`.
- 최종 블록 적용 → Timeline에서 순서·시작 시간 확인 → Save → Export → Export MP4.

## 관찰한 결과

MP4가 실제로 생성됐다. 앱의 내보내기 완료 상태를 확인한 뒤 파일을 Chromium의 영상 및 Web Audio 디코더로 별도 검사했다.

| 항목 | 관찰값 |
| --- | --- |
| 영상 길이 | 6.3초 |
| 해상도 | 640×360 |
| 디코딩된 오디오 | 2채널 |
| 추가 음성 구간 0.1–1.9초 RMS | 약 0.159889 |
| 중간 무음 구간 2.1–4.3초 RMS | 0 |
| 원본 대사 구간 4.6–6.1초 RMS | 약 0.087121 |
| 2.8초 영상 프레임 | `ORBIT LAUNCH` 글자를 육안 확인 |

이 검사는 실제 스트림 디코딩과 해당 구간의 신호 존재를 확인한다. RMS는 음질 평가나 대사 전사의 정확도 판정이 아니다. 최종 출력에서 화면 글자를 확인했으며, 이번 테스트에서 OCR·전사 모델을 다시 실행한 것은 아니다.

## 발견하고 수정한 오류

렌더링 후 FFprobe를 시작할 때 Windows Application Control이 동기적으로 `spawn UNKNOWN`을 발생시켰다. 기존 코드는 비동기 `error` 이벤트만 처리했기 때문에 완성된 MP4도 내보내기 실패로 처리하고 삭제했다.

`measureExportedFile`이 동기적인 실행 거부도 `null`(검사 불가)로 반환하도록 수정했다. 기존의 ‘검사 불가는 렌더링 실패가 아니다’라는 규칙을 복구한 것이다. 출력은 보존되고 앱의 자동 검사 결과는 미검증으로 남는다. FFprobe 검사를 통과한 것으로 표시하지 않는다. 동기 실행 거부 회귀 테스트를 추가했다.

FFmpeg 스킬의 `probe.py`와 `doctor`도 같은 Windows 정책 오류(4551)로 FFprobe를 실행하지 못했다. 실행 정책을 바꾸거나 차단된 실행 파일을 우회하지 않았다. 위 표는 별도의 Chromium 디코딩 관찰값이며 FFprobe 결과가 아니다.

## 화면과 저장 검증

네 종류 블록 생성, 타입에 맞는 입력 연결, 블록 연쇄, 음성 이어붙이기 적용, 최종 합성 적용, 적용 Undo/Redo, 블록 삭제 Undo, 저장·재열기 후 4개 블록과 8개 연결 유지가 통과했다. 새 Sources 검색·클립 추가·Undo와 Blocks 검색도 확인했다.

자동 정렬 후 소스·처리·합성 순서의 위치를 저장했고, Fit으로 전체 흐름을 표시했다. Appearance 메뉴 열기·Escape 닫기, Assistant 열기·접기, Program Monitor 안에 재생 버튼이 남는 것도 실제 앱에서 검증했다.

로컬 결과는 `.local-runtimes/block-workflow-result.mp4`, `block-output-frame.png`, `block-output-verification.json`, `block-timeline.png`, `block-canvas.png`, `block-export-complete.png`에 보존했다. 로컬 QA 스크립트는 `.local-runtimes/canvas-block-ui.cjs`이며 Windows 전용 실행 환경과 테스트 파일을 사용한다.

최종 빌드의 1360px·1600px 화면, 네이티브 Workspace 메뉴, Appearance 전환과 실제 영상 프레임 미리보기도 확인했다. 데스크톱·모바일 타입 검사와 Electron 빌드는 통과했다. 전체 Vitest는 1,134개 통과, 7개 건너뜀, 기존 FFprobe 정책 차단에 의한 2개 실패(`clipSpeed`, `metadataPrivacyFfmpeg`)다. 모바일 실기기는 검증하지 못했다.
