import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const INSPECTOR_PANEL_SOURCE_URL = new URL('../src/renderer/src/editor/InspectorPanel.tsx', import.meta.url);

function indexOfRequired(source: string, marker: string): number {
  const index = source.indexOf(marker);

  expect(index, `Expected InspectorPanel source to include ${marker}`).toBeGreaterThanOrEqual(0);

  return index;
}

describe('inspector panel selected clip layout', () => {
  it('keeps selected clip trim controls before the selected clip metadata list', async () => {
    const source = await readFile(INSPECTOR_PANEL_SOURCE_URL, 'utf8');
    const selectedClipMetadataIndex = indexOfRequired(source, '<PropertyGroup title="Timing">');
    const toolbarMarkers = [
      'aria-label="Selected clip trim controls"',
      'onClick={editor.splitAtPlayhead}',
      'Split at playhead',
      "editor.trimClipTo(clip.clip.id, 'left', editor.playheadMs)",
      'Trim start here',
      "editor.trimClipTo(clip.clip.id, 'right', editor.playheadMs)",
      'Trim end here',
      'onClick={editor.duplicateSelectedClip}',
      'Duplicate clip',
      'onClick={editor.deleteSelectedClip}',
      'Delete selection'
    ];

    for (const marker of toolbarMarkers) {
      expect(indexOfRequired(source, marker), `Expected ${marker} before selected clip metadata`).toBeLessThan(selectedClipMetadataIndex);
    }
  });

  it('gives every persisted effect input an explicit accessible name', async () => {
    const source = await readFile(INSPECTOR_PANEL_SOURCE_URL, 'utf8');
    const effectInputLabels = [
      'aria-label="Clip effect position X"',
      'aria-label="Clip effect position Y"',
      'aria-label="Clip effect scale"',
      'aria-label="Clip effect rotation"',
      'aria-label="Clip effect opacity"',
      'aria-label="Clip effect volume"'
    ];

    for (const label of effectInputLabels) {
      indexOfRequired(source, label);
    }
  });

  it('does not suppress the visible focus outline on position inputs', async () => {
    const source = await readFile(INSPECTOR_PANEL_SOURCE_URL, 'utf8');

    expect(source).not.toContain("outline: 'none'");
  });
});
