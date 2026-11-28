import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactElement } from 'react';

import { contextPressure, contextUsagePercent, formatContextUsage } from '../../shared/agentChatUsage';
import { useAgentChat } from './AgentChatContext';
import { AgentChatMessageView } from './AgentChatMessageView';
import { AgentChatSessionPicker } from './AgentChatSessionPicker';
import { AgentModelPicker } from './AgentModelPicker';
import { Button } from './ui';

type AgentChatPanelProps = {
  readonly width?: number;
  readonly onCollapse?: () => void;
  readonly inline?: boolean;
  readonly onOpenSettings?: (() => void) | undefined;
};

type AgentChatPanelStyle = CSSProperties & {
  readonly '--agent-chat-panel-width': string;
};

export function AgentChatPanel({ width = 360, onCollapse, inline = false, onOpenSettings }: AgentChatPanelProps): ReactElement {
  const {
    selectedModel,
    hasConnectedProvider,
    modelReady,
    input,
    setInput,
    messages,
    pendingApproval,
    status,
    error,
    isBusy,
    reasoningEffort,
    setReasoningEffort,
    activeProject,
    contextUsage,
    sendMessage,
    respondToApproval,
    resetConversation,
    compactConversation,
    cancelConversation
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
      className={`agent-chat-panel-shell${inline ? ' agent-chat-panel-shell--inline' : ''}`}
      aria-label="OpenScene agent chat"
      style={panelStyle}
    >
      <div className="agent-chat-panel">
        <div className="agent-chat-panel__header">
          <div className="agent-chat-panel__title">
            <p className="agent-chat-panel__title-label">OpenScene Assistant</p>
            <span className="agent-chat-panel__title-meta">
              {modelReady ? `${selectedModel.providerLabel} · ${selectedModel.label}` : '제공자 연결 및 모델 선택 필요'}
            </span>
          </div>
          <div className="agent-chat-panel__actions">
            <Button variant="ghost" onClick={resetConversation} disabled={isBusy} title="Reset conversation" aria-label="Reset conversation">
              Reset
            </Button>
            {onCollapse && <Button
              variant="ghost"
              onClick={onCollapse}
              title="Collapse agent chat"
              aria-label="Collapse agent chat sidebar"
              aria-controls="app-shell-agent-chat"
              aria-expanded={true}
            >
              ⇥
            </Button>}
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
          {!modelReady && <div className="status-card" role="status"><p>{hasConnectedProvider ? '연결된 제공자에서 사용할 편집 모델을 선택하세요.' : '모델 제공자 연결이 필요합니다. 연결 후 사용할 모델을 직접 선택하세요.'}</p>{onOpenSettings && <Button type="button" onClick={onOpenSettings}>모델 제공자 설정</Button>}</div>}
          {messages.map((message) => (
            <AgentChatMessageView key={message.id} message={message} />
          ))}

          {pendingApproval && (
            <div
              className="status-card agent-chat-approval"
              role="status"
            >
              <p className="agent-chat-approval__tool">
                작업을 승인할까요? <strong>{pendingApproval.toolName}</strong>
              </p>
              {pendingApproval.toolName === 'transcribeProjectVideoRange' && (
                <p>OpenScene will transcribe this video range locally and send the timestamped text to the selected chat model.</p>
              )}
              <details><summary>요청 상세 보기</summary>
                <pre className="agent-chat-approval__args">{JSON.stringify(pendingApproval.args, null, 2)}</pre>
              </details>
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
                  한 번 승인
                </Button>
                <Button
                  variant="ghost"
                  disabled={isBusy}
                  title={`Stop asking about ${pendingApproval.toolName} in this conversation`}
                  onClick={() => { setDenialFeedback(''); void respondToApproval('always'); }}
                >
                  이 대화에서 허용
                </Button>
                <Button
                  variant="stop"
                  disabled={isBusy}
                  onClick={() => { const feedback = denialFeedback; setDenialFeedback(''); void respondToApproval('deny', feedback); }}
                >
                  거절
                </Button>
              </div>
            </div>
          )}

          {status === 'thinking' && <p className="agent-chat-status">Working through OpenScene…</p>}
          {error && <div className="agent-chat-error" role="alert"><p>{error}</p></div>}
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
                if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key === 'Process') return;
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
                <AgentModelPicker reasoningEffort={reasoningEffort} onReasoningEffortChange={setReasoningEffort} onOpenSettings={onOpenSettings} />
              </div>
              {isBusy ? <Button type="button" variant="stop" onClick={() => { void cancelConversation(); }}>요청 중지</Button> : <Button
                type="submit"
                variant="primary"
                disabled={isBusy || !modelReady || pendingApproval !== null || input.trim().length === 0}
                aria-label="Send Edit Agent prompt"
              >
                Send
              </Button>}
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
