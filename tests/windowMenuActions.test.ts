import { describe, expect, it } from 'vitest';
import { parseWindowMenuAction } from '../src/shared/windowMenuActions';

describe('window menu bridge', () => {
  it('accepts only the closed set of window actions', () => {
    expect(parseWindowMenuAction('paste')).toBe('paste');
    for (const action of ['executeJavaScript', 'openExternal', { action: 'paste' }, null, 1]) expect(parseWindowMenuAction(action)).toBeNull();
  });
});
