/** Shared structural contract; the advisory adapter owns request semantics. */
export interface JevConfig {
  readonly enabled: boolean;
  readonly model: 'jev-1.14.0';
  /** Uncalibrated selected-option probability policy, not an accuracy guarantee. */
  readonly minSelectedProbability: number;
  readonly timeoutMs: number;
}

export type JevJudgmentConfig = JevConfig;

export const JEV_CONFIG_CHANNELS = { get: 'jev-config:get', set: 'jev-config:set' } as const;

export interface JevConfigApi {
  getJevConfig(): Promise<import('./models').ApiResponse<JevJudgmentConfig>>;
  /** Reset by explicitly setting DEFAULT_JEV_CONFIG. */
  setJevConfig(config: JevJudgmentConfig): Promise<import('./models').ApiResponse<JevJudgmentConfig>>;
}

export const DEFAULT_JEV_CONFIG: Readonly<JevConfig> = Object.freeze({
  enabled: false,
  model: 'jev-1.14.0',
  minSelectedProbability: 0.95,
  timeoutMs: 2500
});

/** Invalid configuration disables the advisory path as a whole. */
export function parseJevConfig(value: unknown): Readonly<JevConfig> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  const fields = ['enabled', 'model', 'minSelectedProbability', 'timeoutMs'];
  if (Object.keys(config).length !== fields.length || fields.some((key) => !Object.hasOwn(config, key))) return null;
  if (typeof config.enabled !== 'boolean' || config.model !== DEFAULT_JEV_CONFIG.model
    || typeof config.minSelectedProbability !== 'number' || !Number.isFinite(config.minSelectedProbability)
    || config.minSelectedProbability < 0.5 || config.minSelectedProbability > 1
    || typeof config.timeoutMs !== 'number' || !Number.isInteger(config.timeoutMs)
    || config.timeoutMs < 1 || config.timeoutMs > 5000) return null;
  return Object.freeze({
    enabled: config.enabled,
    model: config.model,
    minSelectedProbability: config.minSelectedProbability,
    timeoutMs: config.timeoutMs
  });
}

export function resolveJevConfig(value: unknown): Readonly<JevConfig> {
  return parseJevConfig(value) ?? DEFAULT_JEV_CONFIG;
}
