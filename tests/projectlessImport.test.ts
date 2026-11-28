// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { LocalProjectSnapshot } from '../src/shared/timelineTypes';


let cleanup = () => {};
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(() => act(cleanup));
it.each([false, true])('imports directly from an empty natural workspace (folder canceled: %s)', async canceled => {
  const path = '../src/renderer/src/editor/useProjectAssetImports';
  const { useProjectAssetImports } = await import(path);
  const project = { id: 'new-project', assets: [] } as unknown as LocalProjectSnapshot;
  const asset = { id: 'video', kind: 'video' };
  const importProjectAssets = vi.fn().mockResolvedValue({ ok: true, value: { assets: [asset] } });
  Object.assign(window, { videoTool: { importProjectAssets } });
  let loaded: LocalProjectSnapshot | null = null;
  let run!: () => Promise<void>;
  const select = vi.fn();
  function Harness() {
    const [current, setCurrent] = useState<LocalProjectSnapshot | null>(null);
    loaded = current;
    const imports = useProjectAssetImports({ project: current, setProject: setCurrent, setIsBusy: vi.fn(), setSelectedAssetId: select, setStatusMessage: vi.fn(),
      createProjectForImport: async () => { if (canceled) return null; setCurrent(project); return project; } });
    run = imports.importAssets;
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container); cleanup = () => root.unmount();
  await act(async () => root.render(createElement(Harness)));
  await act(async () => run());
  if (canceled) {
    expect(importProjectAssets).not.toHaveBeenCalled(); expect(loaded).toBeNull();
  } else {
    expect(importProjectAssets).toHaveBeenCalledWith({ projectId: 'new-project' });
    expect((loaded as unknown as LocalProjectSnapshot).assets).toEqual([asset]);
    expect(select).toHaveBeenCalledWith('video');
  }
});
