import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactElement } from 'react';

import type { AgentCuaErrorCode } from '../../shared/agentChat';
import { contextPressure, contextUsagePercent, formatContextUsage } from '../../shared/agentChatUsage';
import { useAgentChat } from './AgentChatContext';
import { AgentChatMessageView } from './AgentChatMessageView';
import { AgentChatSessionPicker } from './AgentChatSessionPicker';
import { AgentModelPicker } from './AgentModelPicker';
import { Button } from './ui';

const CUA_ERROR_GUIDANCE: Readonly<Record<AgentCuaErrorCode, string>> = {
  CUA_MODE_REQUIRED: 'Select Window CUA explicitly to use editor-window controls. Project tools mode does not expose or execute them.',
  CUA_MODE_CHANGED: 'A conversation keeps its original mode. Select a mode to start a new conversation; restored chats never opt into Window CUA automatically.',
  CUA_EXPLICIT_SAVE_REQUIRED: 'The live editor may be unsaved. Observe it and approve the explicit Save tool before using saved-project tools.',
  CUA_SAVE_OUTCOME_UNKNOWN: 'The Save publication outcome is unknown. Inspect the saved project before deciding whether to retry.',
  CUA_SAVE_NOT_VERIFIED: 'Save returned a persisted receipt, but the current disk snapshot could not be verified. UI acknowledgement does not verify the saved file.',
  CUA_SAVE_NOT_WRITTEN: 'The explicitly approved snapshot was not saved.',
  CUA_FRAME_STALE: 'The editor layout changed after observation. Ask the agent to re-observe the current frame before retrying.',
  CUA_FRAME_EXPIRED: 'The observed frame expired. Ask the agent to capture a fresh frame before retrying.',
  CUA_SCOPE_CHANGED: 'The active editor window or scope changed. Re-observe the current workspace before approving again.',
  CUA_APPROVAL_EXPIRED: 'The one-use approval permit expired. Request a new proposal to continue.',
  CUA_APPROVAL_MISMATCH: 'The approval no longer matches the pending action. Review a fresh proposal before running.',
  CUA_ACTION_REPLAYED: 'This one-use action permit was already consumed and cannot be replayed.',
  CUA_BUDGET_EXCEEDED: 'The CUA action budget for this run was reached. Start a new request to continue.',
  CUA_CANCELLED: 'CUA execution was stopped and synthetic inputs were released.',
  CUA_BUSY: 'Another CUA observation or action is already active. Wait for it to finish before retrying.',
  CUA_TARGET_GONE: 'The bound editor window is no longer available for CUA actions.',
  CUA_CLEANUP_FAILED: 'CUA execution is locked because input cleanup could not be confirmed. Restart or recover the app before running CUA again.'
};

type AgentChatPanelProps = {
  readonly width: number;
  readonly onCollapse: () => void;
};

type AgentChatPanelStyle = CSSProperties & {
  readonly '--agent-chat-panel-width': string;
};

export function AgentChatPanel({ width, onCollapse }: AgentChatPanelProps): ReactElement {
  const {
    selectedModel,
    isLocalModel,
    modelReady,
    input,
    setInput,
    messages,
    pendingApproval,
    status,
    error,
    errorCode,
    isBusy,
    interactionMode,
    changeInteractionMode,
    reasoningEffort,
    setReasoningEffort,
    activeProject,
    contextUsage,
    sendMessage,
    respondToApproval,
    resetConversation,
    compactConversation
  } = useAgentChat();

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const [denialFeedback, setDenialFeedback] = useState('');
  const usageLabel = formatContextUsage(contextUsage);
  const usagePercent = contextUsagePercent(contextUsage);
  const pressure = contextPressure(contextUsage);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pendingApproval, status]);

  const submitMessage = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void sendMessage(input);
  };

  const panelStyle: AgentChatPanelStyle = { '--agent-chat-panel-width': `${width}px` };

  return (
    <aside
      id="app-shell-agent-chat"
      className="agent-chat-panel-shell"
      aria-label="OpenScene agent chat"
      data-cua-protected="agent-panel"
      data-cua-protected-id="agent-chat-panel"
      style={panelStyle}
    >
      <div className="agent-chat-panel">
        <div className="agent-chat-panel__header">
          <div className="agent-chat-panel__title">
            <p className="agent-chat-panel__title-label">OpenScene Assistant</p>
            <span className="agent-chat-panel__title-meta">
              {selectedModel.label} · {selectedModel.providerLabel} · {isLocalModel ? 'Local' : modelReady ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div className="agent-chat-panel__actions">
            <Button variant="ghost" onClick={resetConversation} disabled={isBusy} title="Reset conversation" aria-label="Reset conversation">
              Reset
            </Button>
            <Button
              variant="ghost"
              onClick={onCollapse}
              title="Collapse agent chat"
              aria-label="Collapse agent chat sidebar"
              aria-controls="app-shell-agent-chat"
              aria-expanded={true}
            >
              ⇥
            </Button>
          </div>
        </div>

        {/* Sessions are per project, so work can be split across conversations. */}
        <div className="agent-chat-panel__sessions">
          <AgentChatSessionPicker />
        </div>

        {/* Project scope: every conversation operates on the active project. */}
        <div className="agent-chat-project-scope">
          {activeProject === null ? (
            <span className="agent-chat-project-scope__empty">Open a project to give the agent project scope.</span>
          ) : (
            <>
              <span className="agent-chat-project-scope__eyebrow">Project scope</span>
              <span className="agent-chat-project-scope__name">{activeProject.name}</span>
              <span className="agent-chat-project-scope__meta">
                {activeProject.assetCount} assets · {activeProject.trackCount} tracks
              </span>
              {usageLabel !== null && (
                <span
                  className={`agent-chat-context-meter agent-chat-context-meter--${pressure}`}
                  title={usagePercent === null ? `${usageLabel} used` : `${usageLabel} of the context window used (${usagePercent}%)`}
                >
                  <span className="agent-chat-context-meter__track" aria-hidden="true">
                    <span className="agent-chat-context-meter__fill" style={{ width: `${usagePercent ?? 0}%` }} />
                  </span>
                  <span className="agent-chat-context-meter__label">
                    {usageLabel}{usagePercent === null ? '' : ` · ${usagePercent}%`}
                  </span>
                </span>
              )}
            </>
          )}
        </div>

        <div className="agent-chat-log" aria-live="polite">
          <div role="group" aria-label="Agent interaction mode">
            <Button variant={interactionMode === 'project-tools' ? 'primary' : 'ghost'} data-testid="agent-mode-project-tools"
              aria-pressed={interactionMode === 'project-tools'} disabled={isBusy || pendingApproval !== null}
              onClick={() => { void changeInteractionMode('project-tools'); }}>Project tools</Button>
            <Button variant={interactionMode === 'self-window' ? 'primary' : 'ghost'} data-testid="agent-mode-self-window"
              aria-pressed={interactionMode === 'self-window'} disabled={isBusy || pendingApproval !== null}
              onClick={() => { void changeInteractionMode('self-window'); }}>Window CUA (desktop)</Button>
          </div>
          <p>Changing mode starts a new conversation after the current run settles. It does not save the project.</p>
          {interactionMode === 'self-window' && <p>Window CUA observes live UI without automatically saving. Saved-project tools require an explicitly approved Save when the UI may be dirty.</p>}

          {!modelReady && (
            <div className="agent-chat-hint-card agent-chat-hint-card--warning">
              <span className="agent-chat-hint-card__icon">⚠️</span>
              <p className="agent-chat-hint-card__text">
                {selectedModel.providerLabel} is not connected. Connect it in Settings → Providers, or pick a local model below.
              </p>
            </div>
          )}

          {messages.length === 0 && (
            <div className="agent-chat-hint-card agent-chat-hint-card--welcome">
              <span className="agent-chat-hint-card__icon">✦</span>
              <p className="agent-chat-hint-card__text">
                Try “Find the part where the speaker introduces the product and trim the clip around it.” Video review uses a vision model, and speech review uses local whisper.cpp.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <AgentChatMessageView key={message.id} message={message} />
          ))}

          {pendingApproval && (
            <div
              className="status-card agent-chat-approval"
              data-cua-protected="approval-ui"
              data-cua-protected-id="agent-chat-approval"
              role="status"
            >
              <p className="agent-chat-approval__tool">
                Run <strong>{pendingApproval.toolName}</strong>?
              </p>
              {pendingApproval.toolName === 'transcribeProjectVideoRange' && (
                <p>OpenScene will transcribe this video range locally and send the timestamped text to the selected chat model.</p>
              )}
              {pendingApproval.cuaApproval !== undefined && (
                <dl className="agent-chat-approval__cua" data-testid="agent-cua-approval-summary">
                  <div>
                    <dt>Action</dt>
                    <dd data-testid="agent-cua-approval-action">
                      <strong>{pendingApproval.cuaApproval.actionKind.toUpperCase()}</strong> · {pendingApproval.cuaApproval.actionLabel}
                    </dd>
                  </div>
                  <div>
                    <dt>Frame</dt>
                    <dd data-testid="agent-cua-approval-frame">{pendingApproval.cuaApproval.frameId}</dd>
                  </div>
                  <div>
                    <dt>Scope revision</dt>
                    <dd data-testid="agent-cua-approval-revision">{String(pendingApproval.cuaApproval.scopeRevision)}</dd>
                  </div>
                  {pendingApproval.cuaApproval.coords !== undefined && (
                    <div>
                      <dt>Coordinates ({pendingApproval.cuaApproval.coordinateSpace ?? 'css'})</dt>
                      <dd data-testid="agent-cua-approval-coords">
                        ({Math.round(pendingApproval.cuaApproval.coords.x)}, {Math.round(pendingApproval.cuaApproval.coords.y)})
                        {pendingApproval.cuaApproval.dragTo !== undefined
                          ? ` → (${Math.round(pendingApproval.cuaApproval.dragTo.x)}, ${Math.round(pendingApproval.cuaApproval.dragTo.y)})`
                          : ''}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              <pre className="agent-chat-approval__args">{JSON.stringify(pendingApproval.args, null, 2)}</pre>
              <label className="agent-chat-approval__feedback">
                <span className="visually-hidden">Why are you denying this action?</span>
                <input
                  type="text"
                  value={denialFeedback}
                  onChange={(event) => setDenialFeedback(event.target.value)}
                  placeholder="Optional — tell the agent what to do instead"
                  disabled={isBusy}
                />
              </label>
              <div className="agent-chat-approval__actions">
                <Button
                  variant="primary"
                  disabled={isBusy}
                  onClick={() => { setDenialFeedback(''); void respondToApproval('approve'); }}
                >
                  Run once
                </Button>
                <Button
                  variant="ghost"
                  disabled={isBusy || pendingApproval.cuaApproval !== undefined}
                  title={pendingApproval.cuaApproval !== undefined
                    ? 'CUA actions require single-use per-action approval'
                    : `Stop asking about ${pendingApproval.toolName} in this conversation`}
                  onClick={() => { setDenialFeedback(''); void respondToApproval('always'); }}
                >
                  Always allow
                </Button>
                <Button
                  variant="stop"
                  disabled={isBusy}
                  onClick={() => { const feedback = denialFeedback; setDenialFeedback(''); void respondToApproval('deny', feedback); }}
                >
                  Deny
                </Button>
              </div>
            </div>
          )}

          {status === 'thinking' && <p className="agent-chat-status">Working through OpenScene…</p>}
          {(error !== undefined || errorCode !== undefined) && (
            <div
              className="status-card status-card--danger"
              role={errorCode === 'CUA_CLEANUP_FAILED' ? 'alert' : 'status'}
              data-testid={errorCode !== undefined ? 'agent-cua-error-code' : undefined}
              data-cua-error-code={errorCode}
            >
              {errorCode !== undefined && (
                <p className="agent-chat-error__guidance">
                  <strong>{errorCode}:</strong> {CUA_ERROR_GUIDANCE[errorCode]}
                </p>
              )}
              {error && <p>{error}</p>}
            </div>
          )}
          <div ref={listEndRef} />
        </div>

        {pressure !== 'ok' && (
          <div className={`agent-chat-context-notice agent-chat-context-notice--${pressure}`} role="status">
            <span>
              {pressure === 'overflow'
                ? 'The conversation fills this model\u2019s context window. Compact it to keep going.'
                : 'This conversation is near the model\u2019s context window.'}
            </span>
            <Button variant="ghost" disabled={isBusy} onClick={() => void compactConversation()}>
              Compact
            </Button>
          </div>
        )}

        <form className="agent-chat-panel__form" onSubmit={submitMessage}>
          <div className="agent-chat-prompt-card">
            <textarea
              className="agent-chat-panel__input agent-chat-prompt-card__textarea"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (!isBusy && modelReady && pendingApproval === null && input.trim().length > 0) {
                    void sendMessage(input);
                  }
                }
              }}
              placeholder={pendingApproval ? 'Respond to the approval above first...' : 'Tell OpenScene what to do…'}
              aria-label="Edit Agent prompt"
              disabled={isBusy || !modelReady || pendingApproval !== null}
              rows={2}
            />
            <div className="agent-chat-prompt-card__toolbar">
              <div className="agent-chat-prompt-card__meta">
                <AgentModelPicker reasoningEffort={reasoningEffort} onReasoningEffortChange={setReasoningEffort} />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={isBusy || !modelReady || pendingApproval !== null || input.trim().length === 0}
                aria-label="Send Edit Agent prompt"
              >
                {isBusy ? 'Working…' : 'Send'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
