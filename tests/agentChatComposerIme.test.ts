// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../src/renderer/src/AgentChatContext', () => ({ useAgentChat: () => ({
  selectedModel: { label: 'Fixture', providerLabel: 'Fixture' }, isLocalModel: true, modelReady: true,
  input: '조합 중인 한국어', setInput: vi.fn(), messages: [], pendingApproval: null, status: 'idle', isBusy: false,
  interactionMode: 'project-tools', activeProject: null, sendMessage: fixture.send,
  changeInteractionMode: vi.fn(), respondToApproval: vi.fn(), resetConversation: vi.fn(), compactConversation: vi.fn()
}) }));
vi.mock('../src/renderer/src/AgentModelPicker', () => ({ AgentModelPicker: () => null }));
vi.mock('../src/renderer/src/AgentChatSessionPicker', () => ({ AgentChatSessionPicker: () => null }));
vi.mock('../src/renderer/src/cua/useCuaOverlay', () => ({ useCuaOverlay: () => null }));

let cleanup: (() => void) | undefined;
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  (globalThis as unknown as { HTMLElement: { prototype: { scrollIntoView: () => void } } }).HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => { act(() => cleanup?.()); cleanup = undefined; fixture.send.mockClear(); });

describe('actual AgentChatPanel composer IME boundary', () => {
  it('ignores composing Enter, key229 and Process; keeps Shift+Enter and ordinary Enter behavior', async () => {
    const path = '../src/renderer/src/AgentChatPanel.tsx';
    const { AgentChatPanel } = await import(path) as { AgentChatPanel: ComponentType<Record<string, unknown>> };
    const doc = (globalThis as unknown as { document: { createElement: (tag: string) => Element; body: { appendChild: (node: Element) => void } } }).document;
    const container = doc.createElement('div'); doc.body.appendChild(container);
    const root = createRoot(container); cleanup = () => { root.unmount(); container.remove(); };
    await act(async () => root.render(createElement(AgentChatPanel, { width: 360, onCollapse: vi.fn() })));
    const textarea = container.querySelector('[aria-label="Edit Agent prompt"]')!;
    const EventCtor = (globalThis as unknown as { KeyboardEvent: new (name: string, options: object) => Event }).KeyboardEvent;
    for (const options of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Process' }, { key: 'Enter', shiftKey: true }]) {
      const event = new EventCtor('keydown', { bubbles: true, cancelable: true, ...options });
      act(() => { textarea.dispatchEvent(event); });
      expect(fixture.send).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
    }
    const enter = new EventCtor('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => { textarea.dispatchEvent(enter); });
    expect(fixture.send).toHaveBeenCalledExactlyOnceWith('조합 중인 한국어'); expect(enter.defaultPrevented).toBe(true);
  });
});
