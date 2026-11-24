/** Shared structural contract; the advisory adapter owns request semantics. */
export interface JevConfig {
  readonly enabled: boolean;
  readonly model: 'jev-1.14.0';
  /** Uncalibrated selected-option probability policy, not an accuracy guarantee. */
  readonly minSelectedProbability: number;
  readonly timeoutMs: number;
}

export const DEFAULT_JEV_CONFIG: Readonly<JevConfig> = Object.freeze({
  enabled: false,
  model: 'jev-1.14.0',
  minSelectedProbability: 0.95,
  timeoutMs: 2500
});

/** Invalid configuration disables the advisory path as a whole. */
export function resolveJevConfig(value: unknown): Readonly<JevConfig> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_JEV_CONFIG;
  const config = value as Record<string, unknown>;
  if (typeof config.enabled !== 'boolean' || config.model !== DEFAULT_JEV_CONFIG.model
    || typeof config.minSelectedProbability !== 'number' || !Number.isFinite(config.minSelectedProbability)
    || config.minSelectedProbability < 0.5 || config.minSelectedProbability > 1
    || typeof config.timeoutMs !== 'number' || !Number.isInteger(config.timeoutMs)
    || config.timeoutMs < 1 || config.timeoutMs > 5000) return DEFAULT_JEV_CONFIG;
  return Object.freeze({
    enabled: config.enabled,
    model: config.model,
    minSelectedProbability: config.minSelectedProbability,
    timeoutMs: config.timeoutMs
  });
}
