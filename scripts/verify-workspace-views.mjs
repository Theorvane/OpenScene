#!/usr/bin/env node
/**
 * Real mounted Electron 43 Chromium QA verification for OpenScene Phase 1A Workspace Views.
 *
 * Mounts the REAL React `WorkspaceShell`, `NaturalStudioView`, `WorkspaceIntakeView`,
 * and `NodeWorkflowImpactPanel` with a sample QA fixture (kept strictly in this harness),
 * verifying:
 * - Zero Chromium/Electron console warnings or runtime errors
 * - Full 9/9 viewport x zoom matrix (1280x800, 1440x900, 1920x1080 x 100%, 125%, 150%)
 *   with zero horizontal overflow and zero clipped buttons/labels
 * - Nested Settings Sheet & header DropdownMenu inside WorkspaceShell with
 *   `document.elementFromPoint` proving `[data-cua-stop]` remains unobstructed
 * - Interactive transitions: natural -> precision -> node (with impact preview) -> intake,
 *   candidate selection, partial_error -> retry -> done, long Korean strings & long filename ellipsis
 * - Captures clean PNG screenshots into `/tmp/openscene-phase1a-qa/` (outside git repo).
 */

import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';

const REPO_ROOT = resolve(process.cwd());
const SCREENSHOT_DIR = '/tmp/openscene-phase1a-qa';
const ELECTRON_BIN = resolve(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

const HARNESS_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenScene Phase 1A Workspace QA</title>
  </head>
  <body style="margin:0;padding:0;background:var(--os-ui-bg);color:var(--os-ui-fg);overflow:hidden;">
    <div id="root"></div>
    <script type="module" src="./entry.tsx"></script>
  </body>
</html>
`;

const HARNESS_ENTRY = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '${resolve(REPO_ROOT, 'src/renderer/styles/ui-tokens.css').replace(/\\/g, '/')}';
import '${resolve(REPO_ROOT, 'src/renderer/styles/ui-primitives.css').replace(/\\/g, '/')}';
import '${resolve(REPO_ROOT, 'src/renderer/styles/workspace-shell.css').replace(/\\/g, '/')}';
import { Button } from '${resolve(REPO_ROOT, 'src/renderer/components/ui/index.ts').replace(/\\/g, '/')}';
import {
  NaturalStudioView,
  NodeWorkflowImpactPanel,
  WorkspaceIntakeView,
  WorkspaceShell,
  type NodeImpactSummary,
  type WorkspaceCandidateItem,
  type WorkspaceExportStatus,
  type WorkspaceMode
} from '${resolve(REPO_ROOT, 'src/renderer/components/workspace/index.ts').replace(/\\/g, '/')}';

declare global {
  interface Window {
    __WS_QA__?: {
      stopClicks: number;
      saveClicks: number;
      windowSaveLeakCount: number;
      cuaCaptureActive: boolean;
      cuaCaptureEscapeCount: number;
      composerSubmitCount: number;
      intakeStartCount: number;
      setMode: (mode: WorkspaceMode) => void;
      setExportStatus: (status: WorkspaceExportStatus) => void;
    };
  }
}

const INITIAL_PROJECTS = [
  {
    id: 'proj-launch',
    name: '2026_가을_제품론칭_키노트_초장문_프로젝트_파일명_최종편집본_v12_master.mp4',
    updatedAtLabel: '방금',
    durationLabel: '14:28',
    shortCount: 3,
    sourceFileName: '2026_가을_제품론칭_키노트_초장문_프로젝트_파일명_최종편집본_v12_master.mp4'
  },
  {
    id: 'proj-interview',
    name: '고객 인터뷰 하이라이트',
    updatedAtLabel: '2시간 전',
    durationLabel: '26:10',
    shortCount: 4
  }
] as const;

const INITIAL_CANDIDATES: WorkspaceCandidateItem[] = [
  {
    id: 'cand-1',
    index: 1,
    title: '자연어 편집 핵심 소개',
    startSec: 22,
    endSec: 58,
    reason: '발표 오프닝에서 제품 가치를 가장 간결하게 설명하는 구간',
    caption: '원하는 편집을 문장으로 설명하고, 필요한 부분만 타임라인에서 정밀하게 다듬습니다.',
    selected: true,
    fitMode: 'contain',
    scalePercent: 100,
    offsetXPercent: 0
  },
  {
    id: 'cand-2',
    index: 2,
    title: '로컬 멀티쇼츠 일괄 생성 데모',
    startSec: 184,
    endSec: 226,
    reason: '후보 선정부터 9:16 검토 및 일괄 MP4 내보내기까지 이어지는 시연',
    caption: '원본 영상은 로컬에 그대로 보존되며 각 쇼츠는 독립 프로젝트로 수정할 수 있습니다.',
    selected: true,
    fitMode: 'manual',
    scalePercent: 125,
    offsetXPercent: -10
  },
  {
    id: 'cand-3',
    index: 3,
    title: '마무리 Q&A 요약',
    startSec: 612,
    endSec: 650,
    reason: '청중 질문에 대한 핵심 답변이 완결된 문장으로 끝나는 구간',
    caption: '모든 렌더링은 로컬 FFmpeg로 실행되어 출력 파일을 직접 검증할 수 있습니다.',
    selected: false,
    fitMode: 'contain',
    scalePercent: 100,
    offsetXPercent: 0
  }
];

function QaApp() {
  const [mode, setMode] = useState<WorkspaceMode>('natural');
  const [activeProjectId, setActiveProjectId] = useState<string>('proj-launch');
  const [candidates, setCandidates] = useState<WorkspaceCandidateItem[]>(INITIAL_CANDIDATES);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('cand-1');
  const [composerValue, setComposerValue] = useState<string>('');
  const [intakePrompt, setIntakePrompt] = useState<string>('');
  const [exportStatus, setExportStatus] = useState<WorkspaceExportStatus>({
    kind: 'partial_error',
    completedIds: ['cand-1'],
    failedItems: [
      { id: 'cand-2', title: '로컬 멀티쇼츠 일괄 생성 데모', error: 'ffmpeg exited with code 1: libx264 encoder timeout' }
    ],
    rawError: 'ffmpeg exited with code 1: libx264 encoder timeout (cand-2)'
  });
  const [approvalVisible, setApprovalVisible] = useState<boolean>(true);
  const [impactSummary, setImpactSummary] = useState<NodeImpactSummary | null>({
    workflowName: '9:16 하이라이트 + 자막 정규화',
    preserveManualCaptions: true,
    items: [
      { id: 'imp-1', targetLabel: '비디오 트랙 V1 구간 컷 (3개 클립)', category: 'overwrite', detail: '노드 트리밍 출력으로 타임라인 구간을 재구성합니다.' },
      { id: 'imp-2', targetLabel: '수동 수정 자막 6개', category: 'preservable', detail: '옵션 유지 시 기존 자막 텍스트와 스타일을 그대로 보존합니다.' }
    ]
  });

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (window.__WS_QA__) window.__WS_QA__.windowSaveLeakCount += 1;
      }
    };
    const onCaptureEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.__WS_QA__?.cuaCaptureActive) {
        window.__WS_QA__.cuaCaptureEscapeCount += 1;
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('keydown', onCaptureEscape, { capture: true });
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
      window.removeEventListener('keydown', onCaptureEscape, { capture: true });
    };
  }, []);

  window.__WS_QA__ = {
    stopClicks: window.__WS_QA__?.stopClicks ?? 0,
    saveClicks: window.__WS_QA__?.saveClicks ?? 0,
    windowSaveLeakCount: window.__WS_QA__?.windowSaveLeakCount ?? 0,
    cuaCaptureActive: window.__WS_QA__?.cuaCaptureActive ?? false,
    cuaCaptureEscapeCount: window.__WS_QA__?.cuaCaptureEscapeCount ?? 0,
    composerSubmitCount: window.__WS_QA__?.composerSubmitCount ?? 0,
    intakeStartCount: window.__WS_QA__?.intakeStartCount ?? 0,
    setMode,
    setExportStatus
  };

  return (
    <WorkspaceShell
      mode={mode}
      onModeChange={(next) => setMode(next)}
      projects={INITIAL_PROJECTS}
      activeProjectId={activeProjectId}
      onSelectProject={(id) => {
        setActiveProjectId(id);
        setMode('natural');
      }}
      onNewVideo={() => setMode('intake')}
      candidates={candidates}
      activeCandidateId={selectedCandidateId}
      onSelectCandidate={(id) => {
        setSelectedCandidateId(id);
        if (mode === 'intake') setMode('natural');
      }}
      safety={{
        sourcePreserved: true,
        dirty: true,
        pendingApprovalCount: approvalVisible ? 1 : 0,
        cuaStatus: 'ready',
        cuaLabel: '자동 조작 준비됨'
      }}
      canUndo={true}
      onUndo={() => {}}
      onSave={() => {
        if (window.__WS_QA__) window.__WS_QA__.saveClicks += 1;
      }}
      onStop={() => {
        if (window.__WS_QA__) window.__WS_QA__.stopClicks += 1;
      }}
      assetsDrawerContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="os-ui-panel">2026_가을_제품론칭_키노트_초장문_프로젝트_파일명_최종편집본_v12_master.mp4</div>
        </div>
      }
      settingsDrawerContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="qa-settings-sheet-body">
          <div className="os-ui-banner os-ui-banner--ok">
            <span>로컬 FFmpeg &amp; whisper.cpp 준비됨</span>
          </div>
          <Button variant="default" size="sm">Jev 연결 점검</Button>
        </div>
      }
    >
      {mode === 'intake' && (
        <WorkspaceIntakeView
          prompt={intakePrompt}
          onPromptChange={setIntakePrompt}
          presets={[
            { id: 'shorts3', label: '핵심 쇼츠 3개 추출', prompt: '핵심 발언 3구간을 30~45초 9:16 쇼츠로 추출해 주세요.' },
            { id: 'silence', label: '무음 정리 + 자막', prompt: '긴 무음 구간을 정리하고 한국어 자막 초안을 생성해 주세요.' }
          ]}
          recentProjects={INITIAL_PROJECTS}
          onPickMedia={() => {}}
          onStart={() => {
            if (window.__WS_QA__) window.__WS_QA__.intakeStartCount += 1;
            setMode('natural');
          }}
          onOpenRecentProject={(id) => {
            setActiveProjectId(id);
            setMode('natural');
          }}
        />
      )}

      {mode === 'natural' && (
        <NaturalStudioView
          turns={[
            { id: 't1', role: 'user', content: '키노트 영상에서 핵심 발언 3구간을 9:16 쇼츠 후보로 뽑고 자막 초안을 만들어 주세요.', timestampLabel: '08:42' },
            { id: 't2', role: 'assistant', content: '로컬 음성 전사와 구간 분석을 마쳐 3개 후보를 준비했습니다. 각 후보의 구간·프레이밍·자막을 바로 다듬고 일괄 내보내기할 수 있습니다.' }
          ]}
          steps={[
            { id: 's1', label: '원본 메타데이터 및 무결성 확인', status: 'done', detail: '14:28 · 1080p' },
            { id: 's2', label: '로컬 whisper.cpp 음성 전사 완료', status: 'done', detail: '142 cues' },
            { id: 's3', label: '쇼츠 후보 3개 선정 및 검토 대기', status: 'done', detail: '3개' }
          ]}
          approval={
            approvalVisible
              ? {
                  id: 'appr-1',
                  title: '선택한 2개 쇼츠 프로젝트 생성 승인',
                  summary: '원본 프로젝트는 변경하지 않고, 별도 편집 가능한 로컬 쇼츠 프로젝트 2개를 생성합니다.',
                  technical: {
                    frameId: 'cua-frame-041',
                    layoutRevision: 7,
                    contentRevision: 12,
                    snapshotId: 'snap-20261125-01',
                    timelineDigest: 'sha256:9c84e1b0a7d3'
                  }
                }
              : null
          }
          onApprove={() => setApprovalVisible(false)}
          onDeny={() => setApprovalVisible(false)}
          candidates={candidates}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={setSelectedCandidateId}
          onToggleCandidate={(id, checked) =>
            setCandidates((prev) => prev.map((item) => (item.id === id ? { ...item, selected: checked } : item)))
          }
          exportStatus={exportStatus}
          onExportSelected={() => setExportStatus({ kind: 'done', completedCount: 2, totalCount: 2 })}
          onRetryExport={() => setExportStatus({ kind: 'done', completedCount: 2, totalCount: 2 })}
          onRetryFailedExport={() =>
            setExportStatus({
              kind: 'done',
              completedCount: 2,
              totalCount: 2,
              summary: '완료: 실패 항목 재시도 성공 (총 2/2개 MP4 내보내기 완료)'
            })
          }
          composerValue={composerValue}
          onComposerChange={setComposerValue}
          onComposerSubmit={() => {
            if (window.__WS_QA__) window.__WS_QA__.composerSubmitCount += 1;
            setComposerValue('');
          }}
          onUpdateCandidateRange={(id, range) =>
            setCandidates((prev) => prev.map((item) => (item.id === id ? { ...item, ...range } : item)))
          }
          onUpdateCandidateTransform={(id, transform) =>
            setCandidates((prev) =>
              prev.map((item) => (item.id === id ? { ...item, ...transform, fitMode: 'manual' } : item))
            )
          }
          onResetContain={(id) =>
            setCandidates((prev) =>
              prev.map((item) =>
                item.id === id ? { ...item, fitMode: 'contain', scalePercent: 100, offsetXPercent: 0 } : item
              )
            )
          }
          onUpdateCandidateCaption={(id, caption) =>
            setCandidates((prev) => prev.map((item) => (item.id === id ? { ...item, caption } : item)))
          }
          onOpenPrecisionTab={() => setMode('precision')}
        />
      )}

      {mode === 'precision' && (
        <div
          data-testid="precision-host-slot"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--os-ui-fg-muted)'
          }}
        >
          기존 TimelineEditor 호스트 슬롯 (Phase 1B 연결 예정)
        </div>
      )}

      {mode === 'node' && (
        <NodeWorkflowImpactPanel
          workflowTitle="9:16 하이라이트 + 자막 정규화"
          impactSummary={impactSummary}
          onAutoArrange={() => {}}
          onFitViewport={() => {}}
          onRequestImpactPreview={() =>
            setImpactSummary((curr) =>
              curr ?? {
                workflowName: '9:16 하이라이트 + 자막 정규화',
                preserveManualCaptions: true,
                items: [
                  { id: 'imp-1', targetLabel: '비디오 트랙 V1 구간 컷', category: 'overwrite', detail: '노드 출력으로 교체됩니다.' }
                ]
              }
            )
          }
          onTogglePreserveManualCaptions={(preserve) =>
            setImpactSummary((curr) => (curr ? { ...curr, preserveManualCaptions: preserve } : null))
          }
          onConfirmApply={() => setImpactSummary(null)}
          onCancelApply={() => setImpactSummary(null)}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--os-ui-fg-muted)',
              fontSize: 'var(--os-font-size-sm)'
            }}
          >
            기존 VideoConnectionCanvas 호스트 슬롯 (Phase 1B 연결 예정)
          </div>
        </NodeWorkflowImpactPanel>
      )}
    </WorkspaceShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QaApp />
  </React.StrictMode>
);
`;

const ELECTRON_MAIN = `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const htmlPath = process.argv[2];
const screenshotDir = process.argv[3];

async function wait(ms = 70) {
  await new Promise((r) => setTimeout(r, ms));
}

async function capture(win, filename) {
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  const outPath = path.join(screenshotDir, filename);
  await fs.writeFile(outPath, png);
  return { path: outPath, bytes: png.length };
}

app.whenReady().then(async () => {
  await fs.mkdir(screenshotDir, { recursive: true });
  const consoleErrors = [];
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    show: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) {
      consoleErrors.push({ level, message });
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    consoleErrors.push({ level: 3, message: 'render-process-gone: ' + JSON.stringify(details) });
  });

  await win.loadFile(htmlPath);
  await wait(90);

  // 1. 9/9 Viewport x Zoom matrix on Natural Studio view
  const viewports = [
    { width: 1280, height: 800, tag: '1280' },
    { width: 1440, height: 900, tag: '1440' },
    { width: 1920, height: 1080, tag: '1920' }
  ];
  const zooms = [
    { factor: 1.0, tag: '100' },
    { factor: 1.25, tag: '125' },
    { factor: 1.5, tag: '150' }
  ];
  const screenshots = {};
  const matrixResults = [];

  for (const vp of viewports) {
    win.setContentSize(vp.width, vp.height);
    for (const zm of zooms) {
      win.webContents.setZoomFactor(zm.factor);
      await wait(80);
      const metrics = await win.webContents.executeJavaScript(\`
        (() => {
          const docOverflow = document.documentElement.scrollWidth > window.innerWidth;
          const stopBtn = document.querySelector('[data-cua-stop="true"]');
          const stopRect = stopBtn.getBoundingClientRect();
          const stopUnclipped = stopRect.width >= 80 && stopRect.right <= window.innerWidth + 1;
          const projectNameEl = document.querySelector('[data-testid="workspace-project-name"] .os-ui-truncate');
          const projectNameTruncated = projectNameEl ? projectNameEl.scrollWidth > projectNameEl.clientWidth : false;
          const headerButtons = Array.from(document.querySelectorAll('.os-ws-header button'));
          const anyHeaderButtonClipped = headerButtons.some((btn) => {
            const r = btn.getBoundingClientRect();
            return r.width <= 0 || r.height <= 0 || r.right > window.innerWidth + 1;
          });
          const sidebarRect = document.querySelector('.os-ws-sidebar').getBoundingClientRect();
          const newVideoRect = document.querySelector('[data-testid="sidebar-new-video-btn"]').getBoundingClientRect();
          const sidebarButtonUnclipped = newVideoRect.right <= sidebarRect.right + 1;
          return {
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            docOverflow,
            stopWidth: Math.round(stopRect.width),
            stopUnclipped,
            projectNameTruncated,
            anyHeaderButtonClipped,
            sidebarButtonUnclipped
          };
        })();
      \`);
      const key = vp.tag + '-' + zm.tag;
      matrixResults.push({ key, width: vp.width, height: vp.height, zoom: zm.factor, ...metrics });
      if (key === '1440-100') screenshots['natural-1440-100'] = await capture(win, 'natural-1440-100.png');
      if (key === '1280-100') screenshots['natural-1280-100'] = await capture(win, 'natural-1280-100.png');
      if (key === '1440-150') screenshots['natural-1440-150'] = await capture(win, 'natural-1440-150.png');
    }
  }

  // Restore 1440x900 @ 100% for functional + state + screenshot checks
  win.setContentSize(1440, 900);
  win.webContents.setZoomFactor(1.0);
  await wait(80);

  // 2. Scroll stream to bottom so partial_error banner + raw FFmpeg error are fully visible, then capture
  await win.webContents.executeJavaScript(\`
    (() => {
      const vp = document.querySelector('.os-ws-natural__scroll .os-ui-scroll-area__viewport');
      if (vp) vp.scrollTop = vp.scrollHeight;
    })();
  \`);
  await wait(50);
  screenshots['natural-error-retry'] = await capture(win, 'natural-error-retry.png');

  // 2b. Real Chromium keyboard input test for Defect #1: focus child checkbox and send real Space key
  const checkboxCheckedBefore = await win.webContents.executeJavaScript(\`
    (() => {
      const cb = document.querySelector('[data-testid="candidate-checkbox-cand-1"]');
      cb.focus();
      return cb.checked;
    })();
  \`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await wait(80);
  const checkboxCheckedAfterSpace = await win.webContents.executeJavaScript(\`
    document.querySelector('[data-testid="candidate-checkbox-cand-1"]').checked
  \`);
  // Restore checkbox to true so batch export still has selected items
  if (!checkboxCheckedAfterSpace) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await wait(60);
  }

  const flowReport = await win.webContents.executeJavaScript(\`
    (async () => {
      const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
      const partialPresentBefore = Boolean(document.querySelector('[data-testid="export-status-partial-error"]'));
      const rawErrorPreserved = Boolean(document.querySelector('[data-testid="export-raw-error"]')?.textContent?.includes('libx264 encoder timeout'));

      // P2 Accessibility: verify every [role="tab"] aria-controls resolves to a real DOM [role="tabpanel"]
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const allTabAriaControlsResolved =
        tabs.length === 3 &&
        tabs.every((tab) => {
          const id = tab.getAttribute('aria-controls');
          const panel = id ? document.getElementById(id) : null;
          return Boolean(panel && panel.getAttribute('role') === 'tabpanel');
        });

      // Defect #2: IME composition Enter in composer causes 0 submits; normal Enter submits once
      const composer = document.querySelector('[data-testid="natural-composer-input"]');
      const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      textareaSetter.call(composer, '자막 다듬기 테스트');
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      await wait();
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', bubbles: true, cancelable: true }));
      await wait();
      const submitsAfterImeEnter = window.__WS_QA__.composerSubmitCount;
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await wait();
      const submitsAfterNormalEnter = window.__WS_QA__.composerSubmitCount;

      // Select candidate 2 via row keyboard Enter & retry failed export -> transitions to done
      const row2 = document.querySelector('[data-testid="candidate-row-cand-2"]');
      row2.focus();
      row2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await wait();
      const cand2Selected = row2.getAttribute('data-selected') === 'true';

      document.querySelector('[data-testid="export-retry-failed-btn"]').click();
      await wait();
      const doneAfterRetry = Boolean(document.querySelector('[data-testid="export-status-done"]'));

      // Open Settings Sheet & verify CUA Stop button is STILL unobstructed via document.elementFromPoint
      document.querySelector('[data-testid="sidebar-settings-btn"]').click();
      await wait(60);
      const settingsSheet = document.querySelector('[data-os-portal="sheet"][role="dialog"]');
      const stopBtn = document.querySelector('[data-cua-stop="true"]');
      const stopRect = stopBtn.getBoundingClientRect();
      const hitAtStopUnderSheet = document.elementFromPoint(stopRect.left + stopRect.width / 2, stopRect.top + stopRect.height / 2);
      const stopUnobstructedUnderSheet = hitAtStopUnderSheet === stopBtn || stopBtn.contains(hitAtStopUnderSheet);

      // Close Settings Sheet via Escape
      settingsSheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const settingsClosed = !document.querySelector('[data-os-portal="sheet"][role="dialog"]');

      // Defect #4: Open header DropdownMenu, verify Cmd+S & Ctrl+S cause 0 window Save leaks,
      // capture-phase CUA Escape fires first, and CUA Stop remains unobstructed
      const menuTrigger = document.querySelector('[data-testid="workspace-project-menu-trigger"]');
      menuTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }));
      menuTrigger.click();
      await wait();
      const headerMenu = document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      const firstMenuItem = headerMenu.querySelector('[role="menuitem"]');
      const hitAtStopUnderMenu = document.elementFromPoint(stopRect.left + stopRect.width / 2, stopRect.top + stopRect.height / 2);
      const stopUnobstructedUnderMenu = hitAtStopUnderMenu === stopBtn || stopBtn.contains(hitAtStopUnderMenu);

      window.__WS_QA__.windowSaveLeakCount = 0;
      headerMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      headerMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
      if (firstMenuItem) {
        firstMenuItem.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
        firstMenuItem.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
      }
      await wait();
      const menuSaveLeakCount = window.__WS_QA__.windowSaveLeakCount;

      window.__WS_QA__.cuaCaptureActive = true;
      window.__WS_QA__.cuaCaptureEscapeCount = 0;
      headerMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const menuCuaCaptureEscapeCount = window.__WS_QA__.cuaCaptureEscapeCount;
      window.__WS_QA__.cuaCaptureActive = false;

      headerMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const menuClosedAfterNormalEscape = !document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');

      // Switch to Precision tab -> verify host slot
      const precisionTab = document.querySelector('[data-testid="mode-tab-precision"]');
      precisionTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      precisionTab.click();
      await wait();
      const precisionActive = Boolean(document.querySelector('[data-testid="precision-host-slot"]'));

      // Switch to Node tab -> verify impact preview panel (leave open for screenshot)
      const nodeTab = document.querySelector('[data-testid="mode-tab-node"]');
      nodeTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      nodeTab.click();
      await wait(60);
      const nodeImpactVisible = Boolean(document.querySelector('[data-testid="node-impact-panel"]'));

      return {
        partialPresentBefore,
        rawErrorPreserved,
        allTabAriaControlsResolved,
        submitsAfterImeEnter,
        submitsAfterNormalEnter,
        cand2Selected,
        doneAfterRetry,
        settingsSheetMounted: Boolean(settingsSheet),
        stopUnobstructedUnderSheet,
        settingsClosed,
        headerMenuMounted: Boolean(headerMenu),
        stopUnobstructedUnderMenu,
        menuSaveLeakCount,
        menuCuaCaptureEscapeCount,
        menuClosedAfterNormalEscape,
        precisionActive,
        nodeImpactVisible
      };
    })();
  \`);

  screenshots['node-impact-1440-100'] = await capture(win, 'node-impact-1440-100.png');

  // Switch to Intake view, verify Defect #3 (Ctrl/Cmd+Enter while Start disabled causes 0 onStart calls), & capture screenshot
  const intakeReport = await win.webContents.executeJavaScript(\`
    (async () => {
      const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
      document.querySelector('[data-testid="sidebar-new-video-btn"]').click();
      await wait();
      const intakeVisible = Boolean(document.querySelector('[data-testid="workspace-intake-view"]'));
      const docOverflow = document.documentElement.scrollWidth > window.innerWidth;
      const startDisabled = Boolean(document.querySelector('[data-testid="intake-start-btn"]')?.disabled);
      const intakeInput = document.querySelector('[data-testid="intake-prompt-input"]');
      window.__WS_QA__.intakeStartCount = 0;
      intakeInput.focus();
      intakeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      intakeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
      await wait();
      const startCallsWhenDisabled = window.__WS_QA__.intakeStartCount;
      const stillOnIntake = Boolean(document.querySelector('[data-testid="workspace-intake-view"]'));
      return { intakeVisible, docOverflow, startDisabled, startCallsWhenDisabled, stillOnIntake };
    })();
  \`);

  screenshots['intake-1440-100'] = await capture(win, 'intake-1440-100.png');

  process.stdout.write(JSON.stringify({
    matrixResults,
    screenshots,
    checkboxSpaceTest: { checkboxCheckedBefore, checkboxCheckedAfterSpace },
    flowReport,
    intakeReport,
    consoleErrors
  }, null, 2) + '\\n');
  win.destroy();
  app.quit();
});
`;

async function run() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const workDir = await realpath(await mkdtemp(join(tmpdir(), 'openscene-phase1a-qa-')));
  const distDir = join(workDir, 'dist');
  try {
    await symlink(join(REPO_ROOT, 'node_modules'), join(workDir, 'node_modules'), 'dir');
    await writeFile(join(workDir, 'package.json'), JSON.stringify({ name: 'ws-qa', type: 'commonjs' }));
    await writeFile(join(workDir, 'electron-main.cjs'), ELECTRON_MAIN);
    await writeFile(join(workDir, 'index.html'), HARNESS_HTML);
    await writeFile(join(workDir, 'entry.tsx'), HARNESS_ENTRY);

    await viteBuild({
      configFile: false,
      root: workDir,
      base: './',
      logLevel: 'silent',
      plugins: [react()],
      resolve: { preserveSymlinks: false },
      build: { outDir: distDir, emptyOutDir: true }
    });

    const stdout = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        ELECTRON_BIN,
        [join(workDir, 'electron-main.cjs'), join(distDir, 'index.html'), SCREENSHOT_DIR],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }
        }
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        err += chunk.toString();
      });
      child.on('error', rejectPromise);
      child.on('close', (code) => {
        if (code !== 0) {
          rejectPromise(new Error(`Electron QA exited with code ${code}: ${err}`));
          return;
        }
        resolvePromise(out);
      });
    });

    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) {
      throw new Error(`No JSON output from Electron QA: ${stdout}`);
    }
    const parsed = JSON.parse(stdout.slice(jsonStart));
    const { matrixResults, screenshots, checkboxSpaceTest, flowReport, intakeReport, consoleErrors } = parsed;

    const expectedShots = [
      'natural-1440-100',
      'natural-1280-100',
      'natural-1440-150',
      'natural-error-retry',
      'node-impact-1440-100',
      'intake-1440-100'
    ];
    let allScreenshotsValid = true;
    for (const key of expectedShots) {
      const info = screenshots[key];
      if (!info) {
        allScreenshotsValid = false;
        continue;
      }
      const st = await stat(info.path);
      if (st.size < 1000) allScreenshotsValid = false;
    }

    const assertions = [
      ['consoleErrors empty', consoleErrors.length === 0],
      ['all 6 Phase 1A screenshots captured in /tmp/openscene-phase1a-qa/', allScreenshotsValid],
      ['all 9 viewport x zoom cells (1280/1440/1920 x 100%/125%/150%) have zero overflow, unclipped Stop button, unclipped sidebar & header controls', matrixResults.length === 9 && matrixResults.every((row) => !row.docOverflow && row.stopUnclipped && !row.anyHeaderButtonClipped && row.sidebarButtonUnclipped && row.projectNameTruncated)],
      ['partial_error displays preserved raw FFmpeg error', flowReport.partialPresentBefore && flowReport.rawErrorPreserved],
      ['P2 A11y: all 3 [role="tab"] aria-controls resolve to real DOM [role="tabpanel"] elements', flowReport.allTabAriaControlsResolved === true],
      ['Defect #1: Space on focused candidate checkbox flips checked state cleanly', checkboxSpaceTest.checkboxCheckedBefore === true && checkboxSpaceTest.checkboxCheckedAfterSpace === false],
      ['Defect #2: IME composition Enter causes 0 submits; normal Enter submits once', flowReport.submitsAfterImeEnter === 0 && flowReport.submitsAfterNormalEnter === 1],
      ['candidate selection works via row keyboard Enter', flowReport.cand2Selected],
      ['retry-failed transitions partial_error -> done', flowReport.doneAfterRetry],
      ['Settings Sheet opens & CUA Stop stays unobstructed via elementFromPoint', flowReport.settingsSheetMounted && flowReport.stopUnobstructedUnderSheet && flowReport.settingsClosed],
      ['Defect #4: Header DropdownMenu blocks Cmd+S & Ctrl+S from leaking to window Save while CUA capture Escape & unobstructed Stop work', flowReport.headerMenuMounted && flowReport.stopUnobstructedUnderMenu && flowReport.menuSaveLeakCount === 0 && flowReport.menuCuaCaptureEscapeCount === 1 && flowReport.menuClosedAfterNormalEscape],
      ['Precision tab mounts host slot cleanly', flowReport.precisionActive],
      ['Node tab mounts NodeWorkflowImpactPanel cleanly', flowReport.nodeImpactVisible],
      ['Defect #3: Intake empty state disables Start and Ctrl/Cmd+Enter causes 0 onStart calls with zero overflow', intakeReport.intakeVisible && !intakeReport.docOverflow && intakeReport.startDisabled && intakeReport.startCallsWhenDisabled === 0 && intakeReport.stillOnIntake]
    ];

    const failures = assertions.filter(([, ok]) => !ok).map(([name]) => name);
    console.log(
      JSON.stringify(
        {
          passed: assertions.length - failures.length,
          total: assertions.length,
          failures,
          screenshots,
          checkboxSpaceTest,
          matrixResults,
          flowReport,
          intakeReport,
          consoleErrors
        },
        null,
        2
      )
    );
    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
