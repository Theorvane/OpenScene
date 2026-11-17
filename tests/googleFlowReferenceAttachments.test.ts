import { describe, expect, it } from 'vitest';
import {
  buildGoogleFlowReferenceAttachmentsProbe,
  googleFlowReferencesReady
} from '../src/main/googleFlowReferenceAttachments';

const ready = { visibleCount: 2, readyCount: 2, busy: false };

describe('Flow reference attachment count gate', () => {
  it('requires the exact expected decoded count and an idle composer', () => {
    expect(googleFlowReferencesReady(ready, 2)).toBe(true);
    expect(googleFlowReferencesReady(ready, 1)).toBe(false);
    expect(googleFlowReferencesReady(ready, 3)).toBe(false);
    expect(googleFlowReferencesReady({ ...ready, readyCount: 1 }, 2)).toBe(false);
    expect(googleFlowReferencesReady({ ...ready, busy: true }, 2)).toBe(false);
    expect(googleFlowReferencesReady(undefined, 2)).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid expected counts: %s', (count) => {
    expect(googleFlowReferencesReady(ready, count)).toBe(false);
  });

  // Execute the actual injected expression, not a second copy of its algorithm.
  const evaluate = new Function('explicitPromptEntry', 'visibleRect', `return ${buildGoogleFlowReferenceAttachmentsProbe()}`);
  const visibleRect = (node: { hidden?: boolean }) => node.hidden ? null : { x: 1, y: 1, width: 10, height: 10 };
  const image = { complete: true, naturalWidth: 100, naturalHeight: 100 };
  const composer = (images: unknown[], busy: unknown[] = [], ariaBusy = false) => ({
    querySelectorAll: (selector: string) => selector === 'img' ? images : busy,
    getAttribute: () => ariaBusy ? 'true' : null
  });
  const prompt = (container: unknown) => ({ element: { closest: (selector: string) => {
    expect(selector).toBe('flow-rich-text-editor, .prompt-input');
    return container;
  } } });

  it('counts only visible decoded composer images, never queries the document/library', () => {
    const result = evaluate(prompt(composer([
      image, image, { ...image, hidden: true }, { ...image, complete: false },
      { ...image, naturalWidth: 0 }, { ...image, naturalHeight: 0 }
    ])), visibleRect);
    expect(result).toEqual({ visibleCount: 5, readyCount: 2, busy: false });
    expect(Object.keys(result)).toEqual(['visibleCount', 'readyCount', 'busy']);
  });

  it('returns unknown for an unrecognized, missing, or hidden composer', () => {
    expect(evaluate(undefined, visibleRect)).toBeUndefined();
    expect(evaluate(prompt(null), visibleRect)).toBeUndefined();
    expect(evaluate(prompt({ ...composer([]), hidden: true }), visibleRect)).toBeUndefined();
  });

  it('rejects visible progress and aria-busy, ignores hidden progress', () => {
    expect(evaluate(prompt(composer([image], [{}])), visibleRect).busy).toBe(true);
    expect(evaluate(prompt(composer([image], [], true)), visibleRect).busy).toBe(true);
    expect(evaluate(prompt(composer([image], [{ hidden: true }])), visibleRect).busy).toBe(false);
  });
});
