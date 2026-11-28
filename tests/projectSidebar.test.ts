// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const sidebarPath = '../src/renderer/src/ProjectSidebar';
const { ProjectSidebar } = await import(sidebarPath);
it('offers one create/open action and confirms external removal without claiming to delete files', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const remove = vi.fn(async () => false);
  try {
    await act(async () => root.render(createElement(ProjectSidebar, { projects: [{ id: 'a', name: 'Fixture', storage: 'external' }], activeProjectId: 'a', busy: false, onSelect: vi.fn(), onCreate: vi.fn(), onOpen: vi.fn(), onRename: vi.fn(), onCloseProject: vi.fn(), onRemove: remove })));
    expect(host.querySelectorAll('[aria-label="새 프로젝트"]')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="프로젝트 폴더 열기"]')).toHaveLength(1);
    act(() => { host.querySelector<HTMLDetailsElement>('details')!.open = true; });
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '삭제')!.click());
    expect(document.body.textContent).toContain('폴더와 파일은 보존');
    expect(remove).not.toHaveBeenCalled();
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '목록에서 제거')!.click());
    expect(remove).toHaveBeenCalledWith('a');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('삭제하지 못했습니다');
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="프로젝트 작업 닫기"]')!.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.activeElement).toBe(host.querySelector('summary'));
  } finally { act(() => root.unmount()); host.remove(); }
});
