import type { ReactElement } from 'react';

import type { CuaPhase, CuaState } from '../../../shared/cua';
import { isCuaStoppablePhase } from './cuaSurfaceSnapshot';
import './cuaOverlay.css';

export interface CuaOverlayProps {
  readonly state: CuaState;
  readonly stopPending: boolean;
  readonly stopError: string | null;
  readonly agentBusy?: boolean;
  readonly onStop: () => void;
}

const PHASE_LABELS: Readonly<Record<CuaPhase, string>> = {
  idle: 'Idle',
  ready: 'CUA Ready',
  preparing: 'Preparing CUA…',
  acting: 'CUA Acting',
  stopping: 'Stopping CUA…',
  stopped: 'CUA Stopped',
  'cleanup-failed': 'Cleanup Failed'
};

export function getCuaCursorMode(state: CuaState, stopPending: boolean): 'dragging' | 'acting' | 'stopping' | 'cleanup-failed' | 'ready' | 'stopped' {
  if (state.phase === 'cleanup-failed') return 'cleanup-failed';
  if (stopPending || state.phase === 'stopping') return 'stopping';
  if (state.dragStart !== null) return 'dragging';
  if (state.phase === 'acting') return 'acting';
  if (state.phase === 'stopped') return 'stopped';
  return 'ready';
}

export function getCuaCleanupStatusText(state: CuaState, stopPending: boolean): string | null {
  if (state.phase === 'cleanup-failed') {
    return 'Input cleanup failed — CUA execution is locked until recovered.';
  }
  if (stopPending || state.phase === 'stopping') {
    return 'Stopping… waiting for driver cleanup confirmation.';
  }
  if (state.phase === 'stopped') {
    return state.cleanupComplete
      ? 'Stopped · all synthetic inputs released.'
      : 'Stopped · finishing input cleanup…';
  }
  return null;
}

export function CuaOverlay({ state, stopPending, stopError, agentBusy = false, onStop }: CuaOverlayProps): ReactElement {
  const isActive = state.phase !== 'idle' || stopPending || agentBusy;
  const cursorMode = getCuaCursorMode(state, stopPending);
  const isStoppingDisplay = stopPending || state.phase === 'stopping';
  const isCleanupFailed = state.phase === 'cleanup-failed';
  const canClickStop = agentBusy || isCuaStoppablePhase(state.phase);
  // Keep cua-stop-btn enabled while agentBusy/pendingApproval is still active even
  // if main-process CuaDriver transitions phase ready -> stopping -> stopped on
  // mouseDown before mouseUp/click fires, so onStop -> agent-chat:cancel still runs.
  const stopButtonBusy = stopPending || (state.phase === 'stopping' && !agentBusy);
  const stopButtonDisabled = !isActive || !canClickStop || stopButtonBusy;
  const showHudBanner = state.phase !== 'idle' || stopPending;
  const stopButtonLabel = stopButtonBusy
    ? '중지 중…'
    : isCleanupFailed && !agentBusy
      ? '잠김'
      : state.phase === 'stopped' && state.cleanupComplete && !agentBusy
        ? '중지됨'
        : '중지 (Esc)';
  const cleanupStatus = getCuaCleanupStatusText(state, stopPending);
  const effectiveError = stopError ?? state.error;

  const phaseText = isStoppingDisplay ? 'Stopping CUA…' : PHASE_LABELS[state.phase];
  const cursor = isActive ? state.cursor : null;
  const dragStart = isActive ? state.dragStart : null;
  const target = isActive ? state.target : null;

  return (
    <div
      className={`cua-overlay cua-overlay--${state.phase}${stopPending ? ' cua-overlay--stop-pending' : ''}${isActive ? '' : ' cua-overlay--idle'}`}
      data-testid="cua-overlay"
      data-cua-active={isActive ? 'true' : 'false'}
      data-cua-phase={state.phase}
      data-cua-cleanup-complete={state.cleanupComplete ? 'true' : 'false'}
      data-cua-stop-pending={stopPending ? 'true' : 'false'}
      data-cua-target-gone={state.targetGone ? 'true' : 'false'}
      aria-live="polite"
    >
      {/* Drag path, start point, progress line, and target reticle */}
      {(dragStart !== null || target !== null) && (
        <svg className="cua-overlay__svg" data-testid="cua-drag-svg" aria-hidden="true">
          {dragStart !== null && target !== null && (
            <line
              className="cua-overlay__drag-guide"
              data-testid="cua-drag-guide-line"
              x1={dragStart.x}
              y1={dragStart.y}
              x2={target.x}
              y2={target.y}
            />
          )}
          {dragStart !== null && cursor !== null && (
            <line
              className="cua-overlay__drag-progress"
              data-testid="cua-drag-progress-line"
              x1={dragStart.x}
              y1={dragStart.y}
              x2={cursor.x}
              y2={cursor.y}
            />
          )}
          {dragStart !== null && target !== null && (
            <line
              className="cua-overlay__drag-remaining"
              data-testid="cua-drag-target-line"
              x1={cursor?.x ?? dragStart.x}
              y1={cursor?.y ?? dragStart.y}
              x2={target.x}
              y2={target.y}
            />
          )}
          {dragStart !== null && (
            <g data-testid="cua-drag-start" transform={`translate(${dragStart.x}, ${dragStart.y})`}>
              <circle className="cua-overlay__start-halo" r={10} />
              <circle className="cua-overlay__start-dot" r={4.5} />
            </g>
          )}
          {target !== null && (
            <g
              data-testid={dragStart !== null ? 'cua-drag-target' : 'cua-target-marker'}
              transform={`translate(${target.x}, ${target.y})`}
            >
              <circle className="cua-overlay__target-ring" r={11} />
              <circle className="cua-overlay__target-dot" r={3} />
              <line className="cua-overlay__target-cross" x1={-15} y1={0} x2={-7} y2={0} />
              <line className="cua-overlay__target-cross" x1={7} y1={0} x2={15} y2={0} />
              <line className="cua-overlay__target-cross" x1={0} y1={-15} x2={0} y2={-7} />
              <line className="cua-overlay__target-cross" x1={0} y1={7} x2={0} y2={15} />
            </g>
          )}
        </svg>
      )}

      {/* Virtual cursor anchored at viewport CSS pixels (cursor.x, cursor.y) */}
      {cursor !== null && (
        <div
          className={`cua-cursor cua-cursor--${cursorMode}`}
          data-testid="cua-cursor"
          data-cua-cursor-mode={cursorMode}
          style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` }}
          aria-hidden="true"
        >
          <span className="cua-cursor__ring" />
          <svg className="cua-cursor__arrow" width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path
              d="M2.5 2L17.5 11.2L11.2 12.6L8.4 18.8L2.5 2Z"
              className="cua-cursor__arrow-shape"
            />
          </svg>
          {cursorMode === 'dragging' && (
            <span className="cua-cursor__badge">DRAG</span>
          )}
        </div>
      )}

      {/* Always-mounted fixed-geometry user-only Stop button: stays at immutable
          viewport coords even in phase === 'idle' (opacity: 0; pointer-events: none)
          so idle -> ready -> acting -> stopping -> stopped NEVER shifts protectedRects. */}
      <button
        type="button"
        className={`cua-stop-btn${isActive ? '' : ' cua-stop-btn--idle'}`}
        data-testid="cua-stop-btn"
        data-cua-protected="stop-button"
        data-cua-protected-id="cua-stop-btn"
        aria-label="Stop CUA control"
        aria-hidden={isActive ? undefined : true}
        aria-busy={stopButtonBusy}
        tabIndex={isActive ? 0 : -1}
        disabled={stopButtonDisabled}
        onClick={onStop}
      >
        {stopButtonLabel}
      </button>

      {/* Top HUD banner (status badge, label, cleanup/error/targetGone/lock warnings) */}
      {showHudBanner && <div className="cua-hud" data-testid="cua-hud" role="status">
        <div className="cua-hud__row">
          <span className={`cua-hud__phase cua-hud__phase--${isStoppingDisplay ? 'stopping' : state.phase}`} data-testid="cua-phase-badge">
            <span className="cua-hud__dot" aria-hidden="true" />
            {phaseText}
          </span>
          {state.label !== null && state.label.length > 0 && (
            <span className="cua-hud__label" data-testid="cua-label">
              {state.label}
            </span>
          )}
        </div>

        {cleanupStatus !== null && (
          <p className="cua-hud__cleanup" data-testid="cua-cleanup-status">
            {cleanupStatus}
          </p>
        )}

        {state.targetGone && (
          <p className="cua-hud__target-gone" data-testid="cua-target-gone" role="alert">
            Target editor window is no longer available. CUA execution has halted.
          </p>
        )}

        {effectiveError !== null && effectiveError.length > 0 && (
          <p className="cua-hud__error" data-testid="cua-error" role="alert">
            {effectiveError}
          </p>
        )}

        {isCleanupFailed && (
          <div className="cua-hud__lock-warning" data-testid="cua-cleanup-failed-warning" role="alert">
            <strong>Re-run locked:</strong> CUA cannot start again until input cleanup succeeds.
            {state.releaseFailures.length > 0 && (
              <ul className="cua-hud__failures" data-testid="cua-release-failures">
                {state.releaseFailures.map((failure, index) => (
                  <li key={`${index}-${failure}`}>{failure}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>}
    </div>
  );
}
