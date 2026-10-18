import { describe, expect, it } from 'vitest';
import { JobQueue, type Job, type JobSpec } from '@core/generation/JobQueue';

const spec = (folder: string, extra: Partial<JobSpec> = {}): JobSpec => ({
  vaultId: 'v',
  folder,
  folderTitle: folder,
  kind: 'generate',
  ...extra,
});

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('JobQueue', () => {
  it('runs jobs one at a time in queue order and reports each result', async () => {
    const order: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const q = new JobQueue<string>(
      async (s) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        order.push(s.folder);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return `ok ${s.folder}`;
      },
      () => {},
    );
    q.enqueue(spec('a'));
    q.enqueue(spec('b'));
    q.enqueue(spec('c', { kind: 'regenerate', subtopic: 'x' }));
    await q.idle();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxConcurrent).toBe(1);
    expect(q.list().map((j) => [j.status, j.report])).toEqual([
      ['done', 'ok a'],
      ['done', 'ok b'],
      ['done', 'ok c'],
    ]);
  });

  it('does not queue the same waiting job twice', async () => {
    const gate = deferred();
    const q = new JobQueue<void>(() => gate.promise, () => {});
    const running = q.enqueue(spec('a'));
    const w1 = q.enqueue(spec('a'));
    const w2 = q.enqueue(spec('a'));
    expect(w1.id).not.toBe(running.id); // a run in progress may be followed by one more
    expect(w2.id).toBe(w1.id);
    gate.resolve();
    await q.idle();
    expect(q.list()).toHaveLength(2);
  });

  it('cancels waiting and running jobs, records failures, and dismisses only finished ones', async () => {
    const changes: (readonly Job<void>[])[] = [];
    const q = new JobQueue<void>(
      (s, signal) =>
        s.folder === 'boom'
          ? Promise.reject(new Error('provider down'))
          : new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      (jobs) => changes.push(jobs),
    );
    const a = q.enqueue(spec('a'));
    const b = q.enqueue(spec('b'));
    const c = q.enqueue(spec('boom'));
    q.dismiss(a.id); // still running: ignored
    q.cancel(b.id);
    await new Promise((r) => setTimeout(r, 5));
    q.cancel(a.id);
    await q.idle();
    const byId = new Map(q.list().map((j) => [j.id, j]));
    expect(byId.get(a.id)?.status).toBe('cancelled');
    expect(byId.get(b.id)?.status).toBe('cancelled');
    expect(byId.get(c.id)).toMatchObject({ status: 'failed', error: 'provider down' });
    q.dismiss(c.id);
    expect(q.list().map((j) => j.id)).toEqual([a.id, b.id]);
    expect(changes.length).toBeGreaterThan(3);
  });
});
