import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentChatHistoryStore } from '../src/main/agentChatHistoryStore';
import { ProjectStore } from '../src/main/projectStore';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, writeFile: vi.fn(original.writeFile) };
});

afterEach(() => vi.mocked(writeFile).mockRestore());

async function withHistory(run: (history: AgentChatHistoryStore, projects: ProjectStore, projectId: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'chat-history-concurrency-'));
  try {
    const projects = new ProjectStore(root);
    const project = await projects.create({ name: 'Concurrent chat' });
    await run(new AgentChatHistoryStore(projects), projects, project.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function input(projectId: string, conversationId: string, text = conversationId) {
  return { projectId, conversationId, messages: [{ id: 'user', role: 'user' as const, text }] };
}

describe('project chat history transactions', () => {
  it('retains all concurrently recorded conversations in submission order', async () => {
    await withHistory(async (history, _projects, projectId) => {
      const ids = Array.from({ length: 16 }, (_, index) => `conversation-${index}`);
      await Promise.all(ids.map((id) => history.record(input(projectId, id))));
      expect((await history.list(projectId)).map((chat) => chat.id)).toEqual([...ids].reverse());
    });
  });

  it('preserves first creation time and last content for concurrent updates', async () => {
    await withHistory(async (history, _projects, projectId) => {
      await Promise.all(Array.from({ length: 12 }, (_, index) => history.record(
        input(projectId, 'same', `turn ${index}`), new Date(Date.UTC(2026, 10, 18, 0, index))
      )));
      expect(await history.get(projectId, 'same')).toMatchObject({
        createdAt: '2026-11-18T00:00:00.000Z',
        updatedAt: '2026-11-18T00:11:00.000Z',
        messages: [{ text: 'turn 11' }]
      });
    });
  });

  it('orders record, delete and another record without resurrecting deleted chats', async () => {
    await withHistory(async (history, _projects, projectId) => {
      await history.record(input(projectId, 'old'));
      const operations = [
        history.record(input(projectId, 'first')),
        history.delete(projectId, 'old'),
        history.record(input(projectId, 'last'))
      ];
      expect((await Promise.all(operations))[1]).toBe(true);
      expect((await history.list(projectId)).map((chat) => chat.id)).toEqual(['last', 'first']);
    });
  });

  it('does not let a queued record resurrect a conversation deleted after that record', async () => {
    await withHistory(async (history, _projects, projectId) => {
      const record = history.record(input(projectId, 'new'));
      const deletion = history.delete(projectId, 'new');
      await record;
      expect(await deletion).toBe(true);
      expect(await history.list(projectId)).toEqual([]);
    });
  });

  it('makes an immediately requested read observe the preceding unawaited record', async () => {
    await withHistory(async (history, _projects, projectId) => {
      const recording = history.record(input(projectId, 'visible'));
      const reading = history.get(projectId, 'visible');
      await recording;
      expect(await reading).toMatchObject({ id: 'visible' });
    });
  });

  it('continues after failed persistence without losing previously committed history', async () => {
    await withHistory(async (history, _projects, projectId) => {
      await history.record(input(projectId, 'committed'));
      vi.mocked(writeFile).mockRejectedValueOnce(new Error('synthetic disk error'));
      const failed = history.record(input(projectId, 'failed'));
      const rejection = expect(failed).rejects.toThrow('synthetic disk error');
      const next = history.record(input(projectId, 'next'));
      await rejection;
      await next;
      expect((await history.list(projectId)).map((chat) => chat.id)).toEqual(['next', 'committed']);
    });
  });

  it('allows a different project to progress while one project write is blocked', async () => {
    await withHistory(async (history, projects, projectId) => {
      const second = await projects.create({ name: 'Independent project' });
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      let started!: () => void;
      const writing = new Promise<void>((resolve) => { started = resolve; });
      const realWrite = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
        started();
        await blocked;
        return realWrite.writeFile(...args);
      });
      const first = history.record(input(projectId, 'blocked'));
      try {
        await writing;
        await history.record(input(second.id, 'independent'));
        expect(await history.get(second.id, 'independent')).not.toBeNull();
      } finally {
        release();
        await first;
      }
      const directory = await projects.resolveDirectory(projectId);
      expect(JSON.parse(await readFile(join(directory, 'chats.json'), 'utf8')).conversations).toHaveLength(1);
    });
  });
});
