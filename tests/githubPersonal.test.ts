import { describe, expect, it } from 'vitest';
// @ts-expect-error Standalone Node tooling intentionally stays outside app compilation.
import { personalApi } from '../scripts/github-personal.mjs';

describe('personal GitHub API guard', () => {
  it.each(['sjungwon03-imbc', 'sjungwon03-ai', '', 'sjungwon03\nother'])('sends zero target requests for actor %s', actor => {
    const calls: string[][] = [];
    const fake = (_: string, args: string[]) => {
      calls.push(args);
      return { status: 0, stdout: args[0] === 'auth' ? 'personal-secret\n' : actor };
    };
    expect(() => personalApi(['repos/Theorvane/OpenScene/issues', '--method', 'POST'], fake, {})).toThrow('no target request sent');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['api', '--hostname', 'github.com', 'user', '--jq', '.login']);
  });
  it('never falls back when explicit personal credentials are missing', () => {
    const calls: string[][] = [];
    expect(() => personalApi(['repos/Theorvane/OpenScene/issues'], (_: string, args: string[]) => {
      calls.push(args); return { status: 1, stdout: '' };
    }, {})).toThrow('credential unavailable');
    expect(calls).toEqual([['auth', 'token', '--hostname', 'github.com', '--user', 'sjungwon03']]);
  });
  it('removes ambient credentials and uses the identical verified token for the target', () => {
    const calls: { args: string[]; env: Record<string, string> }[] = [];
    const result = personalApi(['repos/Theorvane/OpenScene/issues'], (_: string, args: string[], options: {env: Record<string, string>}) => {
      calls.push({ args, env: options.env });
      return { status: 0, stdout: args[0] === 'auth' ? 'personal-secret' : 'sjungwon03\n' };
    }, { GH_TOKEN: 'forbidden', GITHUB_TOKEN: 'forbidden', GH_DEBUG: 'api', GH_HOST: 'other', PATH: '/bin' });
    expect(result.status).toBe(0);
    expect(calls[0]!.env).toEqual({ PATH: '/bin' });
    expect(calls[1]!.env).toBe(calls[2]!.env);
    expect(calls[2]!.env.GH_TOKEN).toBe('personal-secret');
    expect(calls[2]!.env.GH_HOST).toBe('github.com');
  });
  it.each([
    ['https://github.com/Theorvane/OpenScene'], ['repos/other/repo/issues'],
    ['repos/Theorvane/OpenScene/../other'], ['repos/Theorvane/OpenScene/%2e%2e/other'],
    ['repos/Theorvane/OpenScene/issues', '--hostname=other'],
    ['repos/Theorvane/OpenScene/issues', '-HAuthorization: bearer other'],
    ['repos/Theorvane/OpenScene/issues', '--header', 'Authorization: bearer other'],
    ['repos/Theorvane/OpenScene/issues', '--cache=1h'],
  ])('rejects request overrides before any subprocess: %s', (...args) => {
    let count = 0;
    expect(() => personalApi(args, () => { count++; }, {})).toThrow();
    expect(count).toBe(0);
  });
});
