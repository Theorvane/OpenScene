import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('exposes only structured editing tools and no CUA bridge or driver', () => {
  for (const file of ['src/main/index.ts', 'src/main/agentChatTools.ts', 'src/preload/index.ts', 'src/shared/ipc.ts']) {
    expect(readFileSync(file, 'utf8'), file).not.toMatch(/CuaDriver|registerCua|cuaGetState|cuaStop|observeEditorWindow|executeCuaAction|saveCuaEditorProject/);
  }
});
