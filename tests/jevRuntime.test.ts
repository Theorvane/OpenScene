import { describe, expect, it, vi } from 'vitest';
import { createJevRuntime } from '../src/main/jevRuntime';
import { DEFAULT_JEV_CONFIG, resolveJevConfig } from '../src/shared/jevConfig';

describe('Jev runtime dependency injection', () => {
  it('is default-off and never eagerly reads a credential', async () => {
    const service = { getApiKey: vi.fn(async () => null) };
    const runtime = createJevRuntime({ service });
    expect(runtime.getConfig()).toEqual(DEFAULT_JEV_CONFIG);
    expect(runtime.getConfig().enabled).toBe(false);
    expect(service.getApiKey).not.toHaveBeenCalled();
    expect(await runtime.getApiKey()).toBeNull();
    expect(service.getApiKey).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(runtime)).toBe('{}');
  });

  it('reads current config and lazy key when a mock adapter invokes the closures', async () => {
    let config = { ...DEFAULT_JEV_CONFIG, enabled: true };
    const service = { getApiKey: vi.fn(async (): Promise<string | null> => null) };
    const runtime = createJevRuntime({ service, readConfig: () => config });
    const network = vi.fn();
    const mockHook = async () => {
      if (!runtime.getConfig().enabled) return 'fallback';
      const key = await runtime.getApiKey();
      if (!key) return 'fallback';
      network();
      return 'advisory';
    };
    expect(await mockHook()).toBe('fallback');
    expect(network).not.toHaveBeenCalled();
    service.getApiKey.mockResolvedValue('synthetic-value');
    expect(await mockHook()).toBe('advisory');
    expect(network).toHaveBeenCalledTimes(1);
    config = { ...config, enabled: false };
    expect(await mockHook()).toBe('fallback');
    expect(service.getApiKey).toHaveBeenCalledTimes(2);
  });

  it('fails closed for nonfinite, out of range, fractional timeout and unknown model inputs', () => {
    for (const patch of [
      { minSelectedProbability: NaN }, { minSelectedProbability: Infinity },
      { minSelectedProbability: 0.49 }, { minSelectedProbability: 1.01 },
      { timeoutMs: 0 }, { timeoutMs: 5001 }, { timeoutMs: 2.5 }, { timeoutMs: Infinity },
      { enabled: 'true' }, { model: 'unknown' }
    ]) expect(resolveJevConfig({ ...DEFAULT_JEV_CONFIG, enabled: true, ...patch }).enabled).toBe(false);
    expect(resolveJevConfig({ ...DEFAULT_JEV_CONFIG, minSelectedProbability: 0.5, timeoutMs: 1 }).timeoutMs).toBe(1);
    expect(resolveJevConfig({ ...DEFAULT_JEV_CONFIG, minSelectedProbability: 1, timeoutMs: 5000 }).timeoutMs).toBe(5000);
    const runtime = createJevRuntime({ service: { getApiKey: async () => null }, readConfig: () => { throw new Error('synthetic'); } });
    expect(runtime.getConfig().enabled).toBe(false);
  });
});
