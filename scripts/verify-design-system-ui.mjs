#!/usr/bin/env node
/**
 * Real mounted Chromium/Electron QA verification for OpenScene Phase 0 UI primitives.
 *
 * 1. Bundles a live React 19 verification harness importing the real
 *    `src/renderer/styles/ui-tokens.css`, `src/renderer/styles/ui-primitives.css`,
 *    and all 9 components from `src/renderer/components/ui/index.ts`.
 * 2. Launches the installed Electron binary in a hidden, sandboxed BrowserWindow
 *    (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
 * 3. Verifies:
 *    - Computed Orca-neutral tokens, cross-platform Korean/Latin typography, 4px spacing,
 *      and compact desktop heights (28px sm / 32px default).
 *    - Nested portal layering & real `document.elementFromPoint` hit-tests:
 *        * DropdownMenu inside Dialog (clickable above Dialog, Escape closes menu first,
 *          second Escape closes Dialog & restores focus, CUA Stop unobstructed)
 *        * DropdownMenu inside Sheet (same guarantees)
 *        * Tooltip inside Dialog and Sheet (above modal, below CUA Stop)
 *    - Real UI state matrix: loading, empty, error, interactive retry transition,
 *      partial failure, long Korean strings (`word-break: keep-all`), and long filenames
 *      (`text-overflow: ellipsis`) with zero horizontal overflow or button clipping.
 *    - Full 3x3 viewport x DPI zoom matrix:
 *      viewports 1280x800, 1440x900, 1920x1080 at 100%, 125%, 150% zoom.
 *    - Captures real PNG screenshots into `/tmp/openscene-pr572-qa/` (outside git repo).
 *    - Asserts 0 Chromium/Electron console warnings or runtime errors.
 */

import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';

const REPO_ROOT = resolve(process.cwd());
const SCREENSHOT_DIR = '/tmp/openscene-pr572-qa';
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
    <title>OpenScene Phase 0 UI QA</title>
  </head>
  <body style="margin:0;padding:0;background:var(--os-ui-bg);color:var(--os-ui-fg);font-family:var(--os-font-sans);overflow-x:hidden;">
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
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '${resolve(REPO_ROOT, 'src/renderer/components/ui/index.ts').replace(/\\/g, '/')}';

declare global {
  interface Window {
    __QA_STATE__?: {
      cuaStopCount: number;
      saveLeakCount: number;
      menuActionCount: number;
      nestedDialogMenuActionCount: number;
      nestedSheetMenuActionCount: number;
      cuaCaptureActive: boolean;
    };
  }
}

type JobStatus = 'error' | 'loading' | 'ok';

function QaWorkbench() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMenuOpen, setDialogMenuOpen] = useState(false);
  const [dialogTooltipOpen, setDialogTooltipOpen] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMenuOpen, setSheetMenuOpen] = useState(false);
  const [sheetTooltipOpen, setSheetTooltipOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [retryState, setRetryState] = useState<JobStatus>('error');

  useEffect(() => {
    window.__QA_STATE__ = {
      cuaStopCount: 0,
      saveLeakCount: 0,
      menuActionCount: 0,
      nestedDialogMenuActionCount: 0,
      nestedSheetMenuActionCount: 0,
      cuaCaptureActive: false
    };

    const onCaptureEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.__QA_STATE__?.cuaCaptureActive) {
        window.__QA_STATE__.cuaStopCount += 1;
        event.preventDefault();
      }
    };
    const onBubbleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (window.__QA_STATE__) window.__QA_STATE__.saveLeakCount += 1;
      }
    };
    window.addEventListener('keydown', onCaptureEscape, { capture: true });
    window.addEventListener('keydown', onBubbleShortcut);
    return () => {
      window.removeEventListener('keydown', onCaptureEscape, { capture: true });
      window.removeEventListener('keydown', onBubbleShortcut);
    };
  }, []);

  const handleRetry = () => {
    setRetryState('loading');
    window.setTimeout(() => {
      setRetryState('ok');
    }, 30);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <button
        id="cua-stop-sim"
        type="button"
        data-cua-protected="stop-button"
        onClick={() => {
          if (window.__QA_STATE__) window.__QA_STATE__.cuaStopCount += 1;
        }}
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 'var(--os-z-cua-stop)' as unknown as number,
          pointerEvents: 'auto',
          height: 28,
          padding: '0 10px',
          borderRadius: 4,
          border: '1px solid var(--os-ui-danger-border)',
          background: 'var(--os-ui-surface)',
          color: 'var(--os-ui-danger-fg)',
          fontFamily: 'var(--os-font-sans)',
          fontSize: 12,
          fontWeight: 500
        }}
      >
        Stop CUA
      </button>

      <div
        style={{
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: 1120,
          margin: '0 auto',
          padding: '52px 24px 24px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)',
          gap: 16
        }}
      >
        <section className="os-ui-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 'var(--os-font-size-h1)', fontWeight: 600, letterSpacing: '-0.02em' }} className="os-ui-keep-all">
                OpenScene 디자인 시스템 워크벤치
              </h1>
              <p
                id="long-filename"
                className="os-ui-truncate"
                style={{ margin: '4px 0 0', fontSize: 'var(--os-font-size-sm)', color: 'var(--os-ui-fg-muted)' }}
                title="2026_가을_제품론칭_최종편집본_초장문_프로젝트_파일명_v12_final_approved_export_master_4k60.mp4"
              >
                2026_가을_제품론칭_최종편집본_초장문_프로젝트_파일명_v12_final_approved_export_master_4k60.mp4
              </p>
            </div>
            <span className="os-ui-tabular-nums" style={{ fontSize: 'var(--os-font-size-xs)', color: 'var(--os-ui-fg-muted)', flexShrink: 0 }}>
              00:01:24.18
            </span>
          </header>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button id="btn-primary" variant="primary">내보내기 시작</Button>
            <Button id="btn-sm" variant="default" size="sm">컴팩트 28px</Button>
            <Button id="btn-ghost" variant="ghost">보조 작업</Button>
            <Button id="btn-destructive" variant="destructive">삭제</Button>
            <Button id="btn-loading" variant="primary" loading>렌더링 중</Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input id="input-error" error placeholder="클립 이름을 입력하세요" />
            <Textarea
              id="textarea-error"
              error
              defaultValue="긴 한국어 자연어 편집 지시문도 단어 중간에서 어색하게 끊기지 않고 읽기 편하게 줄바꿈되어야 합니다."
            />
          </div>

          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger id="tab-timeline" value="timeline">타임라인</TabsTrigger>
              <TabsTrigger id="tab-canvas" value="canvas">노드 캔버스</TabsTrigger>
              <TabsTrigger id="tab-shorts" value="shorts">쇼츠 검토</TabsTrigger>
            </TabsList>
            <TabsContent id="panel-timeline" value="timeline">
              저장된 타임라인 기준으로 편집과 미리보기를 동기화합니다.
            </TabsContent>
            <TabsContent id="panel-canvas" value="canvas">
              Canvas view active — 노드 그래프 워크플로를 타임라인에 적용합니다.
            </TabsContent>
            <TabsContent id="panel-shorts" value="shorts">
              로컬 후보 구간을 검토하고 개별 프로젝트로 내보냅니다.
            </TabsContent>
          </Tabs>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Dialog open={dialogOpen} onOpenChange={(next) => { setDialogOpen(next); if (!next) { setDialogMenuOpen(false); setDialogTooltipOpen(false); } }}>
              <DialogTrigger asChild>
                <Button id="open-dialog">Open Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>프로젝트 내보내기 설정</DialogTitle>
                  <DialogDescription>
                    모달 내부 드롭다운과 툴팁이 모달 위로 정상 렌더링되고 클릭 가능해야 합니다.
                  </DialogDescription>
                </DialogHeader>
                <Input id="dialog-input" placeholder="출력 파일 이름" />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <DropdownMenu open={dialogMenuOpen} onOpenChange={setDialogMenuOpen}>
                    <DropdownMenuTrigger asChild>
                      <Button id="dialog-nested-menu-trigger" size="sm">프리셋 선택</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>내보내기 프리셋</DropdownMenuLabel>
                      <DropdownMenuItem
                        id="dialog-nested-menu-item"
                        onSelect={() => {
                          if (window.__QA_STATE__) window.__QA_STATE__.nestedDialogMenuActionCount += 1;
                        }}
                      >
                        YouTube 1080p MP4
                        <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive">설정 초기화</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Tooltip open={dialogTooltipOpen} onOpenChange={setDialogTooltipOpen}>
                    <TooltipTrigger asChild>
                      <Button id="dialog-nested-tooltip-trigger" variant="ghost" size="sm" onClick={() => setDialogTooltipOpen((v) => !v)}>
                        도움말
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent id="dialog-nested-tooltip-content">
                      H.264 로컬 FFmpeg 인코딩으로 내보냅니다.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">취소</Button>
                  </DialogClose>
                  <Button variant="primary">확인</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet open={sheetOpen} onOpenChange={(next) => { setSheetOpen(next); if (!next) { setSheetMenuOpen(false); setSheetTooltipOpen(false); } }}>
              <SheetTrigger asChild>
                <Button id="open-sheet">Open Sheet</Button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>클립 인스펙터</SheetTitle>
                  <SheetDescription>사이드 시트 내부 메뉴와 툴팁 레이어링 검증.</SheetDescription>
                </SheetHeader>
                <Textarea id="sheet-textarea" placeholder="메모" />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <DropdownMenu open={sheetMenuOpen} onOpenChange={setSheetMenuOpen}>
                    <DropdownMenuTrigger asChild>
                      <Button id="sheet-nested-menu-trigger" size="sm">트랙 메뉴</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>오디오 / 비디오</DropdownMenuLabel>
                      <DropdownMenuItem
                        id="sheet-nested-menu-item"
                        onSelect={() => {
                          if (window.__QA_STATE__) window.__QA_STATE__.nestedSheetMenuActionCount += 1;
                        }}
                      >
                        오디오 트랙 분리
                        <DropdownMenuShortcut>⇧D</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Tooltip open={sheetTooltipOpen} onOpenChange={setSheetTooltipOpen}>
                    <TooltipTrigger asChild>
                      <Button id="sheet-nested-tooltip-trigger" variant="ghost" size="sm" onClick={() => setSheetTooltipOpen((v) => !v)}>
                        팁
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent id="sheet-nested-tooltip-content">
                      시트 위로 표시되는 모노크롬 툴팁
                    </TooltipContent>
                  </Tooltip>
                </div>
                <SheetFooter>
                  <Button variant="primary">완료</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button id="open-menu">Open Menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Clip Actions</DropdownMenuLabel>
                <DropdownMenuItem
                  id="menu-item-split"
                  onSelect={() => {
                    if (window.__QA_STATE__) window.__QA_STATE__.menuActionCount += 1;
                  }}
                >
                  Split clip
                  <DropdownMenuShortcut>S</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
              <TooltipTrigger asChild>
                <Button id="open-tooltip" onClick={() => setTooltipOpen((v) => !v)}>Tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Monochrome tooltip</TooltipContent>
            </Tooltip>
          </div>
        </section>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div className="os-ui-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--os-font-size-h2)', fontWeight: 600 }}>상태 매트릭스</h2>

            <div id="retry-banner" className={retryState === 'error' ? 'os-ui-banner os-ui-banner--danger' : retryState === 'loading' ? 'os-ui-banner os-ui-banner--info' : 'os-ui-banner os-ui-banner--ok'}>
              <span className="os-ui-keep-all">
                {retryState === 'error' && '오류: 프레임 추출 작업이 중단되었습니다.'}
                {retryState === 'loading' && '재시도 중: FFmpeg 작업을 다시 실행하고 있습니다.'}
                {retryState === 'ok' && '완료: 3/3 작업이 정상적으로 복구되었습니다.'}
              </span>
              <Button id="retry-action-btn" size="sm" variant={retryState === 'error' ? 'default' : 'ghost'} loading={retryState === 'loading'} onClick={handleRetry}>
                {retryState === 'ok' ? '완료됨' : '다시 시도'}
              </Button>
            </div>

            <div id="partial-failure-banner" className="os-ui-banner os-ui-banner--warn os-ui-tabular-nums">
              <span className="os-ui-keep-all">부분 실패: 쇼츠 내보내기 2/3 완료 · 1개 재시도 필요</span>
              <Button size="sm" variant="ghost">상세</Button>
            </div>

            <div id="empty-state-box" className="os-ui-empty-state">
              <strong style={{ color: 'var(--os-ui-fg)', fontWeight: 600 }}>선택된 클립이 없습니다</strong>
              <span>타임라인에서 클립을 선택하거나 미디어를 가져와 편집을 시작하세요.</span>
            </div>
          </div>

          <div className="os-ui-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 'var(--os-font-size-sm)', color: 'var(--os-ui-fg-muted)' }}>트랙 목록 (ScrollArea)</span>
            <ScrollArea id="scroll-area" style={{ height: 112, border: '1px solid var(--os-ui-border)', borderRadius: 'var(--os-ui-radius-sm)' }}>
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Array.from({ length: 12 }, (_, idx) => (
                  <div key={idx} className="os-ui-tabular-nums" style={{ fontSize: 'var(--os-font-size-sm)', color: 'var(--os-ui-fg-secondary)' }}>
                    V{idx + 1} · 타임라인 트랙 행 {idx + 1}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </aside>
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QaWorkbench />
  </React.StrictMode>
);
`;

const ELECTRON_MAIN = `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const htmlPath = process.argv[2];
const screenshotDir = process.argv[3];

async function wait(ms = 60) {
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
  await wait(80);

  // 1. Viewport & DPI zoom matrix (3x3 = 9 checks) + key screenshots
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
  const screenshotKeys = new Set(['1280-100', '1440-100', '1920-100', '1440-125', '1440-150']);
  const matrixResults = [];
  const screenshots = {};

  for (const vp of viewports) {
    win.setContentSize(vp.width, vp.height);
    for (const zm of zooms) {
      win.webContents.setZoomFactor(zm.factor);
      await wait(80);
      const metrics = await win.webContents.executeJavaScript(\`
        (() => {
          const docOverflow = document.documentElement.scrollWidth > window.innerWidth;
          const filenameEl = document.getElementById('long-filename');
          const filenameTruncated = filenameEl ? filenameEl.scrollWidth > filenameEl.clientWidth : false;
          const buttons = Array.from(document.querySelectorAll('button.os-ui-button'));
          const anyButtonClipped = buttons.some((btn) => {
            const rect = btn.getBoundingClientRect();
            return rect.width <= 0 || rect.height <= 0 || rect.right > window.innerWidth + 1;
          });
          const primaryH = getComputedStyle(document.getElementById('btn-primary')).height;
          const smH = getComputedStyle(document.getElementById('btn-sm')).height;
          return {
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            docOverflow,
            filenameTruncated,
            anyButtonClipped,
            primaryH,
            smH
          };
        })();
      \`);
      const key = vp.tag + '-' + zm.tag;
      matrixResults.push({ key, width: vp.width, height: vp.height, zoom: zm.factor, ...metrics });
      if (screenshotKeys.has(key)) {
        screenshots[key] = await capture(win, key + '.png');
      }
    }
  }

  // Restore standard 1440x900 @ 100% for functional + nested hit-test QA
  win.setContentSize(1440, 900);
  win.webContents.setZoomFactor(1.0);
  await wait(80);

  // 2. Capture real nested Dialog + DropdownMenu screenshot while open & run full interactive QA
  const coreReport = await win.webContents.executeJavaScript(\`
    (async () => {
      const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
      const rootStyle = getComputedStyle(document.documentElement);
      const tokens = {
        bg: rootStyle.getPropertyValue('--os-ui-bg').trim(),
        canvas: rootStyle.getPropertyValue('--os-ui-canvas').trim(),
        surface: rootStyle.getPropertyValue('--os-ui-surface').trim(),
        ctaBg: rootStyle.getPropertyValue('--os-ui-cta-bg').trim(),
        space1: rootStyle.getPropertyValue('--os-space-1').trim(),
        space4: rootStyle.getPropertyValue('--os-space-4').trim(),
        fontSizeBody: rootStyle.getPropertyValue('--os-font-size-body').trim(),
        fontSizeH1: rootStyle.getPropertyValue('--os-font-size-h1').trim(),
        fontSizeH2: rootStyle.getPropertyValue('--os-font-size-h2').trim(),
        zSheet: Number(rootStyle.getPropertyValue('--os-z-sheet').trim()),
        zDialog: Number(rootStyle.getPropertyValue('--os-z-dialog').trim()),
        zDropdown: Number(rootStyle.getPropertyValue('--os-z-dropdown').trim()),
        zPopover: Number(rootStyle.getPropertyValue('--os-z-popover').trim()),
        zTooltip: Number(rootStyle.getPropertyValue('--os-z-tooltip').trim()),
        zCuaStop: Number(rootStyle.getPropertyValue('--os-z-cua-stop').trim())
      };

      const btnPrimary = document.getElementById('btn-primary');
      const btnSm = document.getElementById('btn-sm');
      const btnLoading = document.getElementById('btn-loading');
      const inputErr = document.getElementById('input-error');
      const textareaErr = document.getElementById('textarea-error');

      const computed = {
        primaryBg: getComputedStyle(btnPrimary).backgroundColor,
        primaryColor: getComputedStyle(btnPrimary).color,
        primaryHeight: getComputedStyle(btnPrimary).height,
        primaryRadius: getComputedStyle(btnPrimary).borderRadius,
        smHeight: getComputedStyle(btnSm).height,
        loadingDisabled: btnLoading.disabled,
        loadingBusy: btnLoading.getAttribute('aria-busy'),
        loadingSpinnerCount: btnLoading.querySelectorAll('.os-ui-button__spinner').length,
        inputErrorInvalid: inputErr.getAttribute('aria-invalid'),
        inputErrorHeight: getComputedStyle(inputErr).height,
        textareaErrorInvalid: textareaErr.getAttribute('aria-invalid'),
        textareaWordBreak: getComputedStyle(textareaErr).wordBreak,
        scrollViewportPresent: Boolean(document.querySelector('#scroll-area .os-ui-scroll-area__viewport')),
        emptyStatePresent: Boolean(document.getElementById('empty-state-box')),
        partialFailurePresent: Boolean(document.getElementById('partial-failure-banner'))
      };

      // Interactive retry transition: error -> loading -> ok
      const retryBefore = document.getElementById('retry-banner')?.className ?? '';
      document.getElementById('retry-action-btn').click();
      await wait(10);
      const retryDuring = document.getElementById('retry-banner')?.className ?? '';
      await wait(60);
      const retryAfter = document.getElementById('retry-banner')?.className ?? '';
      const retryOk = retryBefore.includes('--danger') && retryDuring.includes('--info') && retryAfter.includes('--ok');

      // Tabs interaction
      const tabCanvas = document.getElementById('tab-canvas');
      tabCanvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      tabCanvas.click();
      await wait();
      const tabsOk = tabCanvas.getAttribute('data-state') === 'active'
        && Boolean(document.getElementById('panel-canvas')?.textContent?.includes('Canvas view active'));

      // Open Dialog + nested DropdownMenu (leave open for screenshot capture right after!)
      const openDialogBtn = document.getElementById('open-dialog');
      openDialogBtn.focus();
      openDialogBtn.click();
      await wait();

      const dialogNestedTrigger = document.getElementById('dialog-nested-menu-trigger');
      dialogNestedTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }));
      dialogNestedTrigger.click();
      await wait(60);

      const dialogEl = document.querySelector('[data-os-portal="dialog"][role="dialog"]');
      const nestedMenuEl = document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      const nestedItemEl = document.getElementById('dialog-nested-menu-item');
      const stopBtn = document.getElementById('cua-stop-sim');

      const itemRect = nestedItemEl.getBoundingClientRect();
      const hitAtNestedItem = document.elementFromPoint(itemRect.left + itemRect.width / 2, itemRect.top + itemRect.height / 2);
      const stopRect = stopBtn.getBoundingClientRect();
      const hitAtStopUnderNested = document.elementFromPoint(stopRect.left + stopRect.width / 2, stopRect.top + stopRect.height / 2);

      const dialogZ = Number(getComputedStyle(dialogEl).zIndex);
      const nestedMenuWrapper = nestedMenuEl.closest('[data-radix-popper-content-wrapper]');
      const nestedMenuZ = Number(getComputedStyle(nestedMenuWrapper || nestedMenuEl).zIndex);
      const stopZ = Number(getComputedStyle(stopBtn).zIndex);
      const nestedMenuWithinViewport = itemRect.left >= 0 && itemRect.top >= 0 && itemRect.right <= window.innerWidth && itemRect.bottom <= window.innerHeight;

      return {
        tokens,
        computed,
        retryOk,
        tabsOk,
        nestedDialogSnapshot: {
          dialogZ,
          nestedMenuZ,
          stopZ,
          hitReturnsNestedItem: hitAtNestedItem === nestedItemEl || Boolean(nestedItemEl.contains(hitAtNestedItem)),
          stopNotObscured: hitAtStopUnderNested === stopBtn,
          nestedMenuWithinViewport
        }
      };
    })();
  \`);

  screenshots['nested-dialog-dropdown'] = await capture(win, 'nested-dialog-dropdown.png');

  // 3. Complete interactive nested Dialog, Sheet, Tooltip, Save isolation, CUA Escape, and Focus Restore assertions
  const interactiveReport = await win.webContents.executeJavaScript(\`
    (async () => {
      const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
      const openDialogBtn = document.getElementById('open-dialog');
      const stopBtn = document.getElementById('cua-stop-sim');
      const stopRect = stopBtn.getBoundingClientRect();

      // Click nested menu item inside Dialog
      document.getElementById('dialog-nested-menu-item').click();
      await wait();
      const dialogStillOpenAfterNestedSelect = Boolean(document.querySelector('[data-os-portal="dialog"][role="dialog"]'));
      const nestedDialogMenuActionCount = window.__QA_STATE__.nestedDialogMenuActionCount;

      // Re-open nested DropdownMenu inside Dialog, verify first Escape closes menu ONLY
      const dialogNestedTrigger = document.getElementById('dialog-nested-menu-trigger');
      dialogNestedTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }));
      dialogNestedTrigger.click();
      await wait();
      const menuInDialog = document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      menuInDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const dialogMenuClosedByFirstEscape = !document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      const dialogStayedOpenAfterFirstEscape = Boolean(document.querySelector('[data-os-portal="dialog"][role="dialog"]'));

      // Nested Tooltip inside Dialog renders above modal (750 > 600) and hits tooltip via elementFromPoint
      document.getElementById('dialog-nested-tooltip-trigger').click();
      await wait();
      const dlgTooltipEl = document.querySelector('[data-os-portal="tooltip"]');
      const dlgTooltipWrapper = dlgTooltipEl?.closest('[data-radix-popper-content-wrapper]');
      const dlgTooltipZ = dlgTooltipEl ? Number(getComputedStyle(dlgTooltipWrapper || dlgTooltipEl).zIndex) : -1;
      const dlgTooltipRect = dlgTooltipEl?.getBoundingClientRect();
      const hitAtDlgTooltip = dlgTooltipRect
        ? document.elementFromPoint(dlgTooltipRect.left + dlgTooltipRect.width / 2, dlgTooltipRect.top + dlgTooltipRect.height / 2)
        : null;
      const dlgTooltipHitOk = Boolean(dlgTooltipEl && (hitAtDlgTooltip === dlgTooltipEl || dlgTooltipEl.contains(hitAtDlgTooltip)));
      document.getElementById('dialog-nested-tooltip-trigger').click();
      await wait();

      // Save shortcut isolation inside Dialog Input
      const dialogInput = document.getElementById('dialog-input');
      dialogInput.focus();
      dialogInput.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      await wait();

      // CUA capture-phase Escape priority
      const dialogEl = document.querySelector('[data-os-portal="dialog"][role="dialog"]');
      window.__QA_STATE__.cuaCaptureActive = true;
      dialogEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const dialogStayedOpenUnderCua = Boolean(document.querySelector('[data-os-portal="dialog"][role="dialog"]'));
      const cuaCountAfterEscape = window.__QA_STATE__.cuaStopCount;

      // Normal Escape closes Dialog & restores focus
      window.__QA_STATE__.cuaCaptureActive = false;
      dialogEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const dialogClosedNormally = !document.querySelector('[data-os-portal="dialog"][role="dialog"]');
      const dialogFocusRestored = document.activeElement === openDialogBtn;

      // Sheet + nested DropdownMenu + nested Tooltip
      const openSheetBtn = document.getElementById('open-sheet');
      openSheetBtn.focus();
      openSheetBtn.click();
      await wait();

      const sheetEl = document.querySelector('[data-os-portal="sheet"][role="dialog"]');
      const sheetZ = Number(getComputedStyle(sheetEl).zIndex);

      const sheetNestedTrigger = document.getElementById('sheet-nested-menu-trigger');
      sheetNestedTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }));
      sheetNestedTrigger.click();
      await wait();

      const sheetMenuEl = document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      const sheetMenuWrapper = sheetMenuEl?.closest('[data-radix-popper-content-wrapper]');
      const sheetMenuZ = sheetMenuEl ? Number(getComputedStyle(sheetMenuWrapper || sheetMenuEl).zIndex) : -1;
      const sheetItemEl = document.getElementById('sheet-nested-menu-item');
      const sheetItemRect = sheetItemEl.getBoundingClientRect();
      const hitAtSheetItem = document.elementFromPoint(sheetItemRect.left + sheetItemRect.width / 2, sheetItemRect.top + sheetItemRect.height / 2);
      const hitAtStopUnderSheetMenu = document.elementFromPoint(stopRect.left + stopRect.width / 2, stopRect.top + stopRect.height / 2);
      const sheetItemHitOk = hitAtSheetItem === sheetItemEl || sheetItemEl.contains(hitAtSheetItem);

      sheetItemEl.click();
      await wait();
      const nestedSheetMenuActionCount = window.__QA_STATE__.nestedSheetMenuActionCount;

      // Re-open Sheet nested menu -> first Escape closes menu only
      sheetNestedTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }));
      sheetNestedTrigger.click();
      await wait();
      const sheetMenuAgain = document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      sheetMenuAgain.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const sheetMenuClosedByFirstEscape = !document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      const sheetStayedOpenAfterFirstEscape = Boolean(document.querySelector('[data-os-portal="sheet"][role="dialog"]'));

      // Nested Tooltip inside Sheet
      document.getElementById('sheet-nested-tooltip-trigger').click();
      await wait();
      const sheetTooltipEl = document.querySelector('[data-os-portal="tooltip"]');
      const sheetTooltipWrapper = sheetTooltipEl?.closest('[data-radix-popper-content-wrapper]');
      const sheetTooltipZ = sheetTooltipEl ? Number(getComputedStyle(sheetTooltipWrapper || sheetTooltipEl).zIndex) : -1;
      document.getElementById('sheet-nested-tooltip-trigger').click();
      await wait();

      // Second Escape closes Sheet & restores focus
      sheetEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const sheetClosed = !document.querySelector('[data-os-portal="sheet"][role="dialog"]');
      const sheetFocusRestored = document.activeElement === openSheetBtn;

      // Top-level DropdownMenu & Tooltip
      const openMenuBtn = document.getElementById('open-menu');
      openMenuBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }));
      openMenuBtn.click();
      await wait();
      const topMenuEl = document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      const topMenuZ = topMenuEl ? Number(getComputedStyle(topMenuEl.closest('[data-radix-popper-content-wrapper]') || topMenuEl).zIndex) : -1;
      document.getElementById('menu-item-split')?.click();
      await wait();

      document.getElementById('open-tooltip').click();
      await wait();
      const topTooltipEl = document.querySelector('[data-os-portal="tooltip"]');
      const topTooltipZ = topTooltipEl ? Number(getComputedStyle(topTooltipEl.closest('[data-radix-popper-content-wrapper]') || topTooltipEl).zIndex) : -1;

      return {
        dialog: {
          dialogStillOpenAfterNestedSelect,
          nestedDialogMenuActionCount,
          dialogMenuClosedByFirstEscape,
          dialogStayedOpenAfterFirstEscape,
          dlgTooltipZ,
          dlgTooltipHitOk,
          saveLeakCount: window.__QA_STATE__.saveLeakCount,
          cuaCountAfterEscape,
          dialogStayedOpenUnderCua,
          dialogClosedNormally,
          dialogFocusRestored
        },
        sheet: {
          sheetZ,
          sheetMenuZ,
          sheetItemHitOk,
          stopNotObscured: hitAtStopUnderSheetMenu === stopBtn,
          nestedSheetMenuActionCount,
          sheetMenuClosedByFirstEscape,
          sheetStayedOpenAfterFirstEscape,
          sheetTooltipZ,
          sheetClosed,
          sheetFocusRestored
        },
        topLevel: {
          topMenuZ,
          menuActionCount: window.__QA_STATE__.menuActionCount,
          topTooltipZ
        }
      };
    })();
  \`);

  const output = { matrixResults, screenshots, coreReport, interactiveReport, consoleErrors };
  process.stdout.write(JSON.stringify(output, null, 2) + '\\n');
  win.destroy();
  app.quit();
});
`;

async function run() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const workDir = await realpath(await mkdtemp(join(tmpdir(), 'openscene-ui-qa-')));
  const distDir = join(workDir, 'dist');
  try {
    await symlink(join(REPO_ROOT, 'node_modules'), join(workDir, 'node_modules'), 'dir');
    await writeFile(join(workDir, 'package.json'), JSON.stringify({ name: 'ui-qa', type: 'commonjs' }));
    await writeFile(join(workDir, 'electron-main.cjs'), ELECTRON_MAIN);
    await writeFile(join(workDir, 'index.html'), HARNESS_HTML);
    await writeFile(join(workDir, 'entry.tsx'), HARNESS_ENTRY);

    await viteBuild({
      configFile: false,
      root: workDir,
      base: './',
      logLevel: 'silent',
      plugins: [react()],
      resolve: {
        preserveSymlinks: false
      },
      build: {
        outDir: distDir,
        emptyOutDir: true
      }
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
      throw new Error(`No JSON report from Electron QA: ${stdout}`);
    }
    const parsed = JSON.parse(stdout.slice(jsonStart));
    const { matrixResults, screenshots, coreReport, interactiveReport, consoleErrors } = parsed;
    const { tokens, computed, retryOk, tabsOk, nestedDialogSnapshot } = coreReport;
    const { dialog, sheet, topLevel } = interactiveReport;

    // Verify all 6 screenshots exist on disk and are non-empty PNGs.
    const expectedScreenshots = [
      '1280-100',
      '1440-100',
      '1920-100',
      '1440-125',
      '1440-150',
      'nested-dialog-dropdown'
    ];
    let allScreenshotsValid = true;
    for (const key of expectedScreenshots) {
      const info = screenshots[key];
      if (!info) {
        allScreenshotsValid = false;
        continue;
      }
      const st = await stat(info.path);
      if (st.size < 1000) {
        allScreenshotsValid = false;
      }
    }

    const assertions = [
      ['consoleErrors empty', consoleErrors.length === 0],
      ['all 6 QA screenshots captured in /tmp/openscene-pr572-qa/', allScreenshotsValid],
      ['token --os-ui-bg === #0a0a0a', tokens.bg === '#0a0a0a'],
      ['token --os-ui-canvas === #121212', tokens.canvas === '#121212'],
      ['token --os-ui-surface === #171717', tokens.surface === '#171717'],
      ['token --os-ui-cta-bg === #e5e5e5', tokens.ctaBg === '#e5e5e5'],
      ['4px spacing tokens (--os-space-1=4px, --os-space-4=16px)', tokens.space1 === '4px' && tokens.space4 === '16px'],
      ['typography scale (body=13px, h2=18px, h1=22px)', tokens.fontSizeBody === '13px' && tokens.fontSizeH2 === '18px' && tokens.fontSizeH1 === '22px'],
      ['z-index order: sheet < dialog < dropdown/popover < tooltip < cuaStop', tokens.zSheet < tokens.zDialog && tokens.zDialog < tokens.zDropdown && tokens.zDropdown === tokens.zPopover && tokens.zDropdown < tokens.zTooltip && tokens.zTooltip < tokens.zCuaStop],
      ['Button primary monochrome bg rgb(229, 229, 229) & fg rgb(23, 23, 23)', computed.primaryBg === 'rgb(229, 229, 229)' && computed.primaryColor === 'rgb(23, 23, 23)'],
      ['Button compact heights (default 32px, sm 28px) & radius 5px', computed.primaryHeight === '32px' && computed.smHeight === '28px' && computed.primaryRadius === '5px'],
      ['Button loading disabled + aria-busy + spinner', computed.loadingDisabled === true && computed.loadingBusy === 'true' && computed.loadingSpinnerCount === 1],
      ['Input error aria-invalid + 32px height', computed.inputErrorInvalid === 'true' && computed.inputErrorHeight === '32px'],
      ['Textarea error aria-invalid + word-break keep-all', computed.textareaErrorInvalid === 'true' && computed.textareaWordBreak === 'keep-all'],
      ['State matrix present (ScrollArea, empty state, partial failure)', computed.scrollViewportPresent && computed.emptyStatePresent && computed.partialFailurePresent],
      ['Interactive Retry transition (error -> loading -> ok)', retryOk === true],
      ['Tabs interactive switch', tabsOk === true],
      ['Nested DropdownMenu in Dialog renders above Dialog & below CUA Stop', nestedDialogSnapshot.nestedMenuZ > nestedDialogSnapshot.dialogZ && nestedDialogSnapshot.nestedMenuZ < nestedDialogSnapshot.stopZ],
      ['Nested DropdownMenu item hit-test in Dialog returns menu item (NOT dialog overlay)', nestedDialogSnapshot.hitReturnsNestedItem === true && nestedDialogSnapshot.nestedMenuWithinViewport === true],
      ['CUA Stop unobstructed during Dialog + nested DropdownMenu', nestedDialogSnapshot.stopNotObscured === true],
      ['Nested DropdownMenu item click in Dialog triggers onSelect & keeps Dialog open', dialog.nestedDialogMenuActionCount === 1 && dialog.dialogStillOpenAfterNestedSelect === true],
      ['Nested DropdownMenu in Dialog: first Escape closes menu only', dialog.dialogMenuClosedByFirstEscape === true && dialog.dialogStayedOpenAfterFirstEscape === true],
      ['Nested Tooltip in Dialog renders above Dialog & below CUA Stop with hit-test', dialog.dlgTooltipZ > nestedDialogSnapshot.dialogZ && dialog.dlgTooltipZ < nestedDialogSnapshot.stopZ && dialog.dlgTooltipHitOk === true],
      ['Dialog Input Cmd+S does not leak', dialog.saveLeakCount === 0],
      ['Dialog capture-phase CUA Escape fires first', dialog.cuaCountAfterEscape === 1 && dialog.dialogStayedOpenUnderCua === true],
      ['Dialog normal Escape closes & restores focus', dialog.dialogClosedNormally === true && dialog.dialogFocusRestored === true],
      ['Nested DropdownMenu in Sheet renders above Sheet & below CUA Stop', sheet.sheetMenuZ > sheet.sheetZ && sheet.sheetMenuZ < nestedDialogSnapshot.stopZ],
      ['Nested DropdownMenu item hit-test in Sheet returns menu item & CUA Stop unobstructed', sheet.sheetItemHitOk === true && sheet.stopNotObscured === true],
      ['Nested DropdownMenu item click in Sheet triggers onSelect', sheet.nestedSheetMenuActionCount === 1],
      ['Nested DropdownMenu in Sheet: first Escape closes menu only', sheet.sheetMenuClosedByFirstEscape === true && sheet.sheetStayedOpenAfterFirstEscape === true],
      ['Nested Tooltip in Sheet renders above Sheet & below CUA Stop', sheet.sheetTooltipZ > sheet.sheetZ && sheet.sheetTooltipZ < nestedDialogSnapshot.stopZ],
      ['Sheet normal Escape closes & restores focus', sheet.sheetClosed === true && sheet.sheetFocusRestored === true],
      ['Top-level DropdownMenu & Tooltip render below CUA Stop & trigger action', topLevel.topMenuZ < nestedDialogSnapshot.stopZ && topLevel.menuActionCount === 1 && topLevel.topTooltipZ < nestedDialogSnapshot.stopZ],
      ['All 9 viewport x zoom matrix cells (1280/1440/1920 x 100%/125%/150%) have zero horizontal overflow & zero button clipping', matrixResults.length === 9 && matrixResults.every((row) => !row.docOverflow && !row.anyButtonClipped && row.filenameTruncated && row.primaryH === '32px' && row.smH === '28px')]
    ];

    const failures = assertions.filter(([, ok]) => !ok).map(([name]) => name);
    console.log(
      JSON.stringify(
        {
          passed: assertions.length - failures.length,
          total: assertions.length,
          failures,
          screenshots,
          matrixResults,
          coreReport,
          interactiveReport,
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
