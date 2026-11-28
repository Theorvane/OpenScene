import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { ExportIpcService } from '../src/main/exportIpcService';
import { ExportJobStore } from '../src/main/exportJobStore';

it('restores a completed export after restart from its verified path-free provenance, but refuses changed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openscene-export-recovery-'));
  const bytes = Buffer.from('fixed output fixture');
  const receipt = { schemaVersion: 2, projectRevision: { projectId: 'project' }, delivery: { exportedAt: '2026-11-28T00:00:00.000Z', output: { fileName: 'export.mp4', fileSizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
  const service = () => new ExportIpcService({ projects: { open: async () => null }, assets: { openPlaybackSource: async () => null }, jobs: new ExportJobStore(), exportsRoot: root, openPath: async () => '' });
  try {
    await writeFile(join(root, 'export.mp4'), bytes);
    await writeFile(join(root, 'export.provenance.json'), JSON.stringify(receipt));
    expect(await service().getExportJob({ jobId: 'export' })).toMatchObject({ ok: true, value: { projectId: 'project', state: { kind: 'completed', fileName: 'export.mp4' } } });
    expect(await service().openExportResult({ jobId: 'export' })).toEqual({ ok: true, value: { opened: true } });
    await writeFile(join(root, 'export.mp4'), Buffer.alloc(bytes.length, 0));
    expect(await service().getExportJob({ jobId: 'export' })).toMatchObject({ ok: false });
    await writeFile(join(root, 'export.mp4'), bytes);
    await rm(join(root, 'export.provenance.json'));
    await writeFile(join(root, 'outside.json'), JSON.stringify(receipt));
    await symlink(join(root, 'outside.json'), join(root, 'export.provenance.json'));
    expect(await service().getExportJob({ jobId: 'export' })).toMatchObject({ ok: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});
