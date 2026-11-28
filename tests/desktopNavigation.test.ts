// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('../src/renderer/src/AgentChatContext', () => ({ AgentChatProvider: ({ children }: { children: ReactNode }) => children, useAgentChat: () => ({ isBusy: false, pendingApproval: null }) }));
vi.mock('../src/renderer/src/AgentChatPanel', () => ({ AgentChatPanel: () => createElement('textarea', { 'aria-label': 'Chat draft', defaultValue: '' }) }));
const shellPath = '../src/renderer/src/AppShell';
const { AppShell } = await import(shellPath);

it('keeps the natural chat draft mounted but hides chat and its toggle in detail modes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const props = { activePage: { id: 'edit', chromeLabel: 'Editor' }, hasActiveProject: true, onPageChange: vi.fn(), activeProjectContext: null } as any;
  try {
    await act(async () => root.render(createElement(AppShell, { ...props, inlineAgentChat: true }, 'Workspace')));
    const draft = host.querySelector('textarea')!; draft.value = 'Keep my cut request';
    await act(async () => root.render(createElement(AppShell, { ...props, inlineAgentChat: false }, 'Workspace')));
    expect(draft.closest('[hidden]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Assistant')).toBe(false);
    await act(async () => root.render(createElement(AppShell, { ...props, inlineAgentChat: true }, 'Workspace')));
    expect(host.querySelector('textarea')).toBe(draft);
    expect(draft.value).toBe('Keep my cut request');
    expect(draft.closest('[hidden]')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});
