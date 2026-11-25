// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement, useState, type ComponentType, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AnyProps = Record<string, unknown>;
type AnyComponent = ComponentType<AnyProps>;

interface WorkspaceExports {
  readonly formatTimecodeSec: (seconds: number) => string;
  readonly WorkspaceShell: AnyComponent;
  readonly WorkspaceIntakeView: AnyComponent;
  readonly NaturalStudioView: AnyComponent;
  readonly NodeWorkflowImpactPanel: AnyComponent;
}

const WORKSPACE_CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles/workspace-shell.css'), 'utf8');

interface DomEl {
  tagName: string;
  textContent: string | null;
  className: string;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
  getAttribute: (name: string) => string | null;
  querySelector: (selector: string) => DomEl | null;
  querySelectorAll: (selector: string) => ArrayLike<DomEl>;
  click: () => void;
  focus: () => void;
  dispatchEvent: (event: unknown) => boolean;
  remove: () => void;
  appendChild: (child: unknown) => unknown;
}

function getDocument(): {
  readonly body: DomEl;
  readonly activeElement: unknown;
  createElement: (tag: string) => DomEl;
  querySelector: (selector: string) => DomEl | null;
  querySelectorAll: (selector: string) => ArrayLike<DomEl>;
} {
  return (globalThis as unknown as { document: ReturnType<typeof getDocument> }).document;
}

function getWindow(): {
  KeyboardEvent: new (type: string, init?: Record<string, unknown>) => unknown;
  MouseEvent: new (type: string, init?: Record<string, unknown>) => unknown;
  Event: new (type: string, init?: Record<string, unknown>) => unknown;
} {
  return (globalThis as unknown as { window: ReturnType<typeof getWindow> }).window;
}

let WS: WorkspaceExports;
let activeRoots: Array<{ root: Root; container: DomEl }> = [];
let consoleErrors: unknown[][] = [];
let consoleWarnings: unknown[][] = [];
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  const win = globalThis as unknown as {
    HTMLElement?: { prototype: Record<string, unknown> };
    PointerEvent?: unknown;
    MouseEvent: unknown;
  };
  if (win.PointerEvent === undefined) {
    win.PointerEvent = win.MouseEvent;
  }
  if (win.HTMLElement !== undefined) {
    if (win.HTMLElement.prototype.hasPointerCapture === undefined) {
      win.HTMLElement.prototype.hasPointerCapture = () => false;
    }
    if (win.HTMLElement.prototype.setPointerCapture === undefined) {
      win.HTMLElement.prototype.setPointerCapture = () => {};
    }
    if (win.HTMLElement.prototype.releasePointerCapture === undefined) {
      win.HTMLElement.prototype.releasePointerCapture = () => {};
    }
    if (win.HTMLElement.prototype.scrollIntoView === undefined) {
      win.HTMLElement.prototype.scrollIntoView = () => {};
    }
  }

  const relativeModule = '../src/renderer/components/workspace/index.ts';
  WS = (await import(relativeModule)) as unknown as WorkspaceExports;
});

beforeEach(() => {
  consoleErrors = [];
  consoleWarnings = [];
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    consoleWarnings.push(args);
  });
});

afterEach(() => {
  for (const entry of activeRoots.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  expect(consoleErrors).toEqual([]);
  expect(consoleWarnings).toEqual([]);
});

function mount(element: ReactElement): DomEl {
  const doc = getDocument();
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  act(() => {
    root.render(element);
  });
  activeRoots.push({ root, container });
  return container;
}

function setReactInputValue(el: DomEl, nextValue: string): void {
  const win = getWindow();
  const proto = el.tagName === 'TEXTAREA'
    ? (globalThis as unknown as { HTMLTextAreaElement: { prototype: object } }).HTMLTextAreaElement.prototype
    : (globalThis as unknown as { HTMLInputElement: { prototype: object } }).HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  act(() => {
    descriptor?.set?.call(el, nextValue);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  });
}

function dispatchKey(target: DomEl, key: string, init: Record<string, unknown> = {}): void {
  const win = getWindow();
  act(() => {
    target.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('Phase 1A Workspace Stylesheet & Helpers', () => {
  it('reuses Phase 0 tokens with zero gradients, zero glow shadows, zero pill soup, and root-stacking CUA Stop', () => {
    expect(WORKSPACE_CSS).toContain('z-index: var(--os-z-cua-stop);');
    expect(WORKSPACE_CSS).not.toMatch(/gradient\(|box-shadow:|999px|9999px/i);
    expect(WS.formatTimecodeSec(0)).toBe('00:00');
    expect(WS.formatTimecodeSec(84)).toBe('01:24');
    expect(WS.formatTimecodeSec(3665)).toBe('01:01:05');
  });
});

describe('WorkspaceShell', () => {
  it('switches across 3 top-level tabs, supports intake mode, exposes CUA Stop protected button, and opens Settings Sheet', async () => {
    const doc = getDocument();
    const onStop = vi.fn();
    const onSave = vi.fn();
    const onUndo = vi.fn();
    const onNewVideo = vi.fn();
    const onSelectProject = vi.fn();
    const onSelectCandidate = vi.fn();

    function ShellHarness(): ReactElement {
      const [mode, setMode] = useState<'natural' | 'precision' | 'node' | 'intake'>('intake');
      return createElement(
        WS.WorkspaceShell,
        {
          mode,
          onModeChange: setMode,
          projects: [
            { id: 'p1', name: '제품 론칭 키노트 편집본', updatedAtLabel: '방금', durationLabel: '12:40' },
            { id: 'p2', name: '인터뷰 원본', updatedAtLabel: '어제', durationLabel: '24:10' }
          ],
          activeProjectId: 'p1',
          onSelectProject,
          onNewVideo,
          candidates: [
            {
              id: 'c1',
              index: 1,
              title: '핵심 발표 오프닝',
              startSec: 18,
              endSec: 52,
              reason: '핵심 문제 제기 구간',
              caption: '오늘 공개할 기능은 자연어 편집입니다.',
              selected: true,
              fitMode: 'contain',
              scalePercent: 100,
              offsetXPercent: 0
            }
          ],
          activeCandidateId: 'c1',
          onSelectCandidate,
          safety: {
            sourcePreserved: true,
            dirty: true,
            pendingApprovalCount: 1,
            cuaStatus: 'acting',
            cuaLabel: '타임라인 트림 실행 중'
          },
          canUndo: true,
          onUndo,
          onSave,
          onStop,
          settingsDrawerContent: createElement('div', { 'data-testid': 'settings-drawer-body' }, 'Jev 연결 설정')
        },
        createElement('div', { 'data-testid': 'active-mode-readout' }, mode)
      );
    }

    const container = mount(createElement(ShellHarness));
    expect(container.querySelector('[data-testid="active-mode-readout"]')?.textContent).toBe('intake');

    // CUA Stop button has fixed protected attributes and fires onStop
    const stopBtn = container.querySelector('[data-testid="workspace-cua-stop-btn"]') as DomEl;
    expect(stopBtn.getAttribute('data-cua-stop')).toBe('true');
    expect(stopBtn.getAttribute('data-cua-protected')).toBe('stop-button');
    expect(stopBtn.getAttribute('data-cua-active')).toBe('true');
    act(() => stopBtn.click());
    expect(onStop).toHaveBeenCalledTimes(1);

    // Safety strip reflects source preserved, dirty state, pending approval, and CUA status
    const safetyText = container.querySelector('[data-testid="workspace-safety-strip"]')?.textContent ?? '';
    expect(safetyText).toContain('원본 파일 보존됨');
    expect(safetyText).toContain('저장되지 않은 변경 있음');
    expect(safetyText).toContain('승인 대기 1건');
    expect(safetyText).toContain('타임라인 트림 실행 중');

    // Top-level 3 tabs switch via mouse/keyboard
    const naturalTab = container.querySelector('[data-testid="mode-tab-natural"]') as DomEl;
    const precisionTab = container.querySelector('[data-testid="mode-tab-precision"]') as DomEl;
    const nodeTab = container.querySelector('[data-testid="mode-tab-node"]') as DomEl;
    const win = getWindow();

    act(() => {
      naturalTab.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      naturalTab.click();
    });
    expect(container.querySelector('[data-testid="active-mode-readout"]')?.textContent).toBe('natural');

    act(() => {
      naturalTab.focus();
    });
    dispatchKey(naturalTab, 'ArrowRight');
    await flush();
    expect(container.querySelector('[data-testid="active-mode-readout"]')?.textContent).toBe('precision');

    dispatchKey(precisionTab, 'ArrowRight');
    await flush();
    expect(container.querySelector('[data-testid="active-mode-readout"]')?.textContent).toBe('node');
    expect(nodeTab.getAttribute('data-state')).toBe('active');

    // Sidebar triggers & Undo/Save
    act(() => (container.querySelector('[data-testid="workspace-undo-btn"]') as DomEl).click());
    act(() => (container.querySelector('[data-testid="workspace-save-btn"]') as DomEl).click());
    act(() => (container.querySelector('[data-testid="sidebar-new-video-btn"]') as DomEl).click());
    act(() => (container.querySelector('[data-testid="sidebar-project-p2"]') as DomEl).click());
    act(() => (container.querySelector('[data-testid="sidebar-candidate-c1"]') as DomEl).click());
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onNewVideo).toHaveBeenCalledTimes(1);
    expect(onSelectProject).toHaveBeenCalledWith('p2');
    expect(onSelectCandidate).toHaveBeenCalledWith('c1');

    // Settings Sheet opens cleanly with data-cua-protected="settings"
    act(() => (container.querySelector('[data-testid="sidebar-settings-btn"]') as DomEl).click());
    const sheet = doc.querySelector('[data-os-portal="sheet"][role="dialog"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute('data-cua-protected')).toBe('settings');
    expect(doc.querySelector('[data-testid="settings-drawer-body"]')?.textContent).toContain('Jev 연결 설정');
  });
});

describe('WorkspaceIntakeView', () => {
  it('handles preset selection, prompt input, start action, error state, and recent project click', () => {
    const onPickMedia = vi.fn();
    const onStart = vi.fn();
    const onOpenRecentProject = vi.fn();

    function IntakeHarness(): ReactElement {
      const [prompt, setPrompt] = useState('');
      return createElement(WS.WorkspaceIntakeView, {
        prompt,
        onPromptChange: setPrompt,
        presets: [
          { id: 'shorts', label: '핵심 쇼츠 3개', prompt: '핵심 발언 3구간을 30초 쇼츠로 뽑아 주세요.' }
        ],
        recentProjects: [
          {
            id: 'r1',
            name: '2026_제품론칭_초장문_원본파일_최종본_master.mp4',
            updatedAtLabel: '10분 전',
            durationLabel: '18:22',
            shortCount: 3
          }
        ],
        errorMessage: '전사 모델을 확인하세요.',
        onPickMedia,
        onStart,
        onOpenRecentProject
      });
    }

    const container = mount(createElement(IntakeHarness));
    expect(container.querySelector('[data-testid="intake-error-banner"]')?.textContent).toContain('전사 모델을 확인하세요.');

    act(() => (container.querySelector('[data-testid="intake-dropzone"]') as DomEl).click());
    expect(onPickMedia).toHaveBeenCalledTimes(1);

    act(() => (container.querySelector('[data-testid="intake-preset-shorts"]') as DomEl).click());
    const startBtn = container.querySelector('[data-testid="intake-start-btn"]') as DomEl;
    expect(startBtn.disabled).toBe(false);
    act(() => startBtn.click());
    expect(onStart).toHaveBeenCalledTimes(1);

    act(() => (container.querySelector('[data-testid="recent-project-r1"]') as DomEl).click());
    expect(onOpenRecentProject).toHaveBeenCalledWith('r1');
  });

  it('never invokes onStart via Ctrl+Enter or Cmd+Enter when Start is disabled or during IME composition', () => {
    const onStart = vi.fn();
    const container = mount(
      createElement(WS.WorkspaceIntakeView, {
        prompt: '   ',
        onPromptChange: vi.fn(),
        presets: [],
        recentProjects: [],
        selectedFileName: null,
        onPickMedia: vi.fn(),
        onStart,
        onOpenRecentProject: vi.fn()
      })
    );

    const textarea = container.querySelector('[data-testid="intake-prompt-input"]') as DomEl;
    const startBtn = container.querySelector('[data-testid="intake-start-btn"]') as DomEl;
    expect(startBtn.disabled).toBe(true);

    dispatchKey(textarea, 'Enter', { ctrlKey: true });
    dispatchKey(textarea, 'Enter', { metaKey: true });
    expect(onStart).not.toHaveBeenCalled();

    // Non-empty prompt during IME composition must not trigger onStart either
    const containerWithText = mount(
      createElement(WS.WorkspaceIntakeView, {
        prompt: '한국어 입력 중',
        onPromptChange: vi.fn(),
        presets: [],
        recentProjects: [],
        selectedFileName: null,
        onPickMedia: vi.fn(),
        onStart,
        onOpenRecentProject: vi.fn()
      })
    );
    const activeTextarea = containerWithText.querySelector('[data-testid="intake-prompt-input"]') as DomEl;
    dispatchKey(activeTextarea, 'Enter', { metaKey: true, isComposing: true });
    dispatchKey(activeTextarea, 'Enter', { ctrlKey: true, keyCode: 229 });
    dispatchKey(activeTextarea, 'Process', { metaKey: true });
    expect(onStart).not.toHaveBeenCalled();

    dispatchKey(activeTextarea, 'Enter', { metaKey: true });
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe('NaturalStudioView', () => {
  it('supports candidate selection, checkbox toggle, inline trim/scale/caption edits, approval card, and export error/partial-retry states', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const onSelectCandidate = vi.fn();
    const onToggleCandidate = vi.fn();
    const onUpdateCandidateRange = vi.fn();
    const onUpdateCandidateTransform = vi.fn();
    const onResetContain = vi.fn();
    const onUpdateCandidateCaption = vi.fn();
    const onOpenPrecisionTab = vi.fn();
    const onExportSelected = vi.fn();
    const onRetryFailedExport = vi.fn();
    const onComposerSubmit = vi.fn();

    const baseProps = {
      turns: [
        { id: 't1', role: 'user', content: '핵심 구간 2개만 쇼츠로 만들어 주세요.', timestampLabel: '08:40' },
        { id: 't2', role: 'assistant', content: '2개 후보를 선정했습니다. 검토 후 내보낼 수 있습니다.' }
      ],
      steps: [
        { id: 's1', label: '로컬 음성 전사 완료', status: 'done', detail: '12:40' },
        { id: 's2', label: '후보 구간 선정 완료', status: 'done', detail: '2개' }
      ],
      approval: {
        id: 'app-1',
        title: '타임라인에 2개 쇼츠 프로젝트 생성',
        summary: '원본은 보존하고 개별 편집 가능한 쇼츠 프로젝트를 생성합니다.',
        technical: {
          frameId: 'frm-102',
          layoutRevision: 4,
          contentRevision: 9,
          snapshotId: 'snap-88',
          timelineDigest: 'sha256:abcdef123456'
        }
      },
      onApprove,
      onDeny,
      candidates: [
        {
          id: 'c1',
          index: 1,
          title: '오프닝 하이라이트',
          startSec: 12,
          endSec: 44,
          reason: '도입부 핵심 메시지',
          caption: '자연어로 편집하고 타임라인에서 다듬습니다.',
          selected: true,
          fitMode: 'contain',
          scalePercent: 100,
          offsetXPercent: 0
        },
        {
          id: 'c2',
          index: 2,
          title: '실시간 데모',
          startSec: 90,
          endSec: 128,
          reason: '제품 동작 핵심 장면',
          caption: '로컬 FFmpeg로 안전하게 내보냅니다.',
          selected: false,
          fitMode: 'manual',
          scalePercent: 135,
          offsetXPercent: -15
        }
      ],
      selectedCandidateId: 'c1',
      onSelectCandidate,
      onToggleCandidate,
      exportStatus: {
        kind: 'partial_error',
        completedIds: ['c1'],
        failedItems: [{ id: 'c2', title: '실시간 데모', error: 'ffmpeg exited with code 1: disk full' }],
        rawError: 'ffmpeg exited with code 1: disk full'
      },
      onExportSelected,
      onRetryFailedExport,
      composerValue: '자막 톤을 조금 더 간결하게 바꿔 주세요',
      onComposerChange: vi.fn(),
      onComposerSubmit,
      onUpdateCandidateRange,
      onUpdateCandidateTransform,
      onResetContain,
      onUpdateCandidateCaption,
      onOpenPrecisionTab
    };

    const container = mount(createElement(WS.NaturalStudioView, baseProps));

    // Approval actions & collapsible technical metadata
    const detailsText = container.querySelector('[data-testid="approval-tech-details"]')?.textContent ?? '';
    expect(detailsText).toContain('frm-102');
    expect(detailsText).toContain('snap-88');
    expect(detailsText).toContain('sha256:abcdef123456');
    act(() => (container.querySelector('[data-testid="approval-approve-btn"]') as DomEl).click());
    act(() => (container.querySelector('[data-testid="approval-deny-btn"]') as DomEl).click());
    expect(onApprove).toHaveBeenCalledWith('app-1');
    expect(onDeny).toHaveBeenCalledWith('app-1');

    // Candidate row selection & checkbox toggle
    act(() => (container.querySelector('[data-testid="candidate-row-c2"]') as DomEl).click());
    expect(onSelectCandidate).toHaveBeenCalledWith('c2');
    act(() => (container.querySelector('[data-testid="candidate-checkbox-c1"]') as DomEl).click());
    expect(onToggleCandidate).toHaveBeenCalledWith('c1', false);

    // Inline inspector controls
    setReactInputValue(container.querySelector('[data-testid="inspector-start-sec"]') as DomEl, '15');
    expect(onUpdateCandidateRange).toHaveBeenCalledWith('c1', { startSec: 15, endSec: 44 });
    setReactInputValue(container.querySelector('[data-testid="inspector-scale-slider"]') as DomEl, '140');
    expect(onUpdateCandidateTransform).toHaveBeenCalledWith('c1', { scalePercent: 140, offsetXPercent: 0 });
    act(() => (container.querySelector('[data-testid="inspector-reset-contain-btn"]') as DomEl).click());
    expect(onResetContain).toHaveBeenCalledWith('c1');
    setReactInputValue(container.querySelector('[data-testid="inspector-caption-textarea"]') as DomEl, '수정된 자막');
    expect(onUpdateCandidateCaption).toHaveBeenCalledWith('c1', '수정된 자막');
    act(() => (container.querySelector('[data-testid="inspector-open-precision-btn"]') as DomEl).click());
    expect(onOpenPrecisionTab).toHaveBeenCalledTimes(1);

    // Partial error preserves raw error and passes failedIds to retry callback
    expect(container.querySelector('[data-testid="export-raw-error"]')?.textContent).toContain('ffmpeg exited with code 1: disk full');
    act(() => (container.querySelector('[data-testid="export-retry-failed-btn"]') as DomEl).click());
    expect(onRetryFailedExport).toHaveBeenCalledWith(['c2']);

    // Composer Enter submits
    dispatchKey(container.querySelector('[data-testid="natural-composer-input"]') as DomEl, 'Enter');
    expect(onComposerSubmit).toHaveBeenCalledTimes(1);
  });

  it('allows Space on focused candidate checkbox without row interception and ignores IME Enter in composer', () => {
    const onSelectCandidate = vi.fn();
    const onToggleCandidate = vi.fn();
    const onComposerSubmit = vi.fn();
    const win = getWindow();

    const container = mount(
      createElement(WS.NaturalStudioView, {
        turns: [],
        steps: [],
        approval: null,
        candidates: [
          {
            id: 'c1',
            index: 1,
            title: '키보드 접근성 테스트',
            startSec: 10,
            endSec: 40,
            reason: '행 내 체크박스 Space 토글 검증',
            caption: '자막 테스트',
            selected: false,
            fitMode: 'contain',
            scalePercent: 100,
            offsetXPercent: 0
          }
        ],
        selectedCandidateId: null,
        onSelectCandidate,
        onToggleCandidate,
        exportStatus: { kind: 'idle' },
        onExportSelected: vi.fn(),
        composerValue: '한국어 조합 중',
        onComposerChange: vi.fn(),
        onComposerSubmit
      })
    );

    // 1. Focusing child checkbox and pressing Space must NOT be prevented by row onKeyDown
    const checkbox = container.querySelector('[data-testid="candidate-checkbox-c1"]') as DomEl;
    const spaceOnCheckbox = new win.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }) as {
      defaultPrevented: boolean;
    };
    act(() => {
      checkbox.focus();
      checkbox.dispatchEvent(spaceOnCheckbox);
    });
    expect(spaceOnCheckbox.defaultPrevented).toBe(false);
    expect(onSelectCandidate).not.toHaveBeenCalled();

    // Focusing the row itself and pressing Space or Enter selects the candidate cleanly
    const row = container.querySelector('[data-testid="candidate-row-c1"]') as DomEl;
    act(() => {
      row.focus();
    });
    dispatchKey(row, ' ');
    dispatchKey(row, 'Enter');
    expect(onSelectCandidate).toHaveBeenCalledTimes(2);
    expect(onSelectCandidate).toHaveBeenCalledWith('c1');

    // 2. IME composition Enter variants must cause 0 submits; normal Enter submits once
    const composer = container.querySelector('[data-testid="natural-composer-input"]') as DomEl;
    dispatchKey(composer, 'Enter', { isComposing: true });
    dispatchKey(composer, 'Enter', { keyCode: 229 });
    dispatchKey(composer, 'Process');
    expect(onComposerSubmit).not.toHaveBeenCalled();

    dispatchKey(composer, 'Enter');
    expect(onComposerSubmit).toHaveBeenCalledTimes(1);
  });

  it('blocks Cmd/Ctrl+S from leaking to window Save listener while WorkspaceShell header DropdownMenu is open', () => {
    const doc = getDocument();
    const globalWin = globalThis as unknown as {
      window: {
        addEventListener: (type: string, fn: (e: unknown) => void, opts?: boolean | { capture?: boolean }) => void;
        removeEventListener: (type: string, fn: (e: unknown) => void, opts?: boolean | { capture?: boolean }) => void;
      };
    };
    const leakedSaves: string[] = [];
    const captureEscapes: string[] = [];

    const onWindowSave = (event: unknown): void => {
      const kb = event as { key: string; metaKey?: boolean; ctrlKey?: boolean };
      if ((kb.metaKey || kb.ctrlKey) && kb.key.toLowerCase() === 's') {
        leakedSaves.push(kb.key);
      }
    };
    const onCaptureEscape = (event: unknown): void => {
      const kb = event as { key: string; preventDefault: () => void };
      if (kb.key === 'Escape') {
        captureEscapes.push('cua-stop');
        kb.preventDefault();
      }
    };

    mount(
      createElement(
        WS.WorkspaceShell,
        {
          mode: 'natural',
          onModeChange: vi.fn(),
          projects: [{ id: 'p1', name: '테스트 프로젝트', updatedAtLabel: '방금' }],
          activeProjectId: 'p1',
          onSelectProject: vi.fn(),
          onNewVideo: vi.fn(),
          safety: { sourcePreserved: true, dirty: false, pendingApprovalCount: 0, cuaStatus: 'idle' },
          onStop: vi.fn()
        },
        createElement('div', null, 'body')
      )
    );

    const win = getWindow();
    const trigger = doc.querySelector('[data-testid="workspace-project-menu-trigger"]') as DomEl;
    act(() => {
      trigger.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      trigger.click();
    });

    const menu = doc.querySelector('[data-os-portal="dropdown-menu"][role="menu"]') as DomEl | null;
    expect(menu).not.toBeNull();

    globalWin.window.addEventListener('keydown', onWindowSave);
    globalWin.window.addEventListener('keydown', onCaptureEscape, { capture: true });
    try {
      dispatchKey(menu as DomEl, 's', { metaKey: true });
      dispatchKey(menu as DomEl, 's', { ctrlKey: true });
      expect(leakedSaves).toEqual([]);

      dispatchKey(menu as DomEl, 'Escape');
      expect(captureEscapes).toEqual(['cua-stop']);
    } finally {
      globalWin.window.removeEventListener('keydown', onWindowSave);
      globalWin.window.removeEventListener('keydown', onCaptureEscape, { capture: true });
    }
  });

  it('renders clean empty states when candidates list is empty and error retry callback on full export error', () => {
    const onRetryExport = vi.fn();
    const container = mount(
      createElement(WS.NaturalStudioView, {
        turns: [],
        steps: [],
        approval: null,
        candidates: [],
        selectedCandidateId: null,
        onSelectCandidate: vi.fn(),
        onToggleCandidate: vi.fn(),
        exportStatus: { kind: 'error', rawError: 'FFmpeg binary not found at configured path' },
        onExportSelected: vi.fn(),
        onRetryExport,
        composerValue: '',
        onComposerChange: vi.fn(),
        onComposerSubmit: vi.fn()
      })
    );

    expect(container.querySelector('[data-testid="candidates-empty-state"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="inspector-empty-state"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-raw-error"]')?.textContent).toContain(
      'FFmpeg binary not found at configured path'
    );
    act(() => (container.querySelector('[data-testid="export-retry-btn"]') as DomEl).click());
    expect(onRetryExport).toHaveBeenCalledTimes(1);
  });
});

describe('NodeWorkflowImpactPanel', () => {
  it('renders manual-edit impact preview with overwrite/preservable items, preserve-captions toggle, single-step Undo notice, and confirm/cancel actions', () => {
    const onTogglePreserve = vi.fn();
    const onConfirmApply = vi.fn();
    const onCancelApply = vi.fn();

    const container = mount(
      createElement(
        WS.NodeWorkflowImpactPanel,
        {
          workflowTitle: '9:16 하이라이트 + 자막 정규화',
          impactSummary: {
            workflowName: '9:16 하이라이트 + 자막 정규화',
            preserveManualCaptions: true,
            items: [
              { id: 'i1', targetLabel: '비디오 트랙 V1 구간 컷', category: 'overwrite', detail: '트리밍 블록 출력으로 교체됩니다.' },
              { id: 'i2', targetLabel: '수동 수정 자막 4개', category: 'preservable', detail: '체크 시 타임코드 기준으로 유지됩니다.' }
            ]
          },
          onTogglePreserveManualCaptions: onTogglePreserve,
          onConfirmApply,
          onCancelApply
        },
        createElement('div', { 'data-testid': 'embedded-canvas-placeholder' }, 'Canvas Host')
      )
    );

    expect(container.querySelector('[data-testid="embedded-canvas-placeholder"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="node-impact-item-i1"]')?.textContent).toContain('덮어씀');
    expect(container.querySelector('[data-testid="node-impact-item-i2"]')?.textContent).toContain('유지 가능');
    expect(container.querySelector('[data-testid="node-undo-guarantee"]')?.textContent).toContain('단일 실행 취소');

    const checkbox = container.querySelector('[data-testid="node-preserve-captions-checkbox"]') as DomEl;
    expect(checkbox.checked).toBe(true);
    act(() => checkbox.click());
    expect(onTogglePreserve).toHaveBeenCalledWith(false);

    act(() => (container.querySelector('[data-testid="node-impact-confirm-btn"]') as DomEl).click());
    act(() => (container.querySelector('[data-testid="node-impact-cancel-btn"]') as DomEl).click());
    expect(onConfirmApply).toHaveBeenCalledTimes(1);
    expect(onCancelApply).toHaveBeenCalledTimes(1);
  });
});
