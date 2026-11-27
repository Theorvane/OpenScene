import { createHash } from 'node:crypto';
import { reaGenerationPlanSchema, type ReaGenerationPlan } from '../shared/reaGeneration';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function generationPlanHash(value: unknown): string {
  return createHash('sha256').update(canonical(reaGenerationPlanSchema.parse(value))).digest('hex');
}
export function freezeGenerationPlan(value: unknown): Readonly<ReaGenerationPlan> {
  const plan = reaGenerationPlanSchema.parse(value);
  const freeze = (v: object): void => { Object.values(v).forEach(x => { if (x && typeof x === 'object') freeze(x); }); Object.freeze(v); };
  freeze(plan);
  return plan;
}
