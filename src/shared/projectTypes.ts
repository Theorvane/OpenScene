export type ProjectType = 'editing' | 'generation';
/** Absence is the legacy mixed project, never inferred from its assets. */
export function parseProjectType(value: unknown): ProjectType | undefined | null {
  return value === undefined ? undefined : value === 'editing' || value === 'generation' ? value : null;
}
