/**
 * Does the model flag factual mistakes in points (and leave correct ones alone)?
 *
 *   LODE_EVAL_BASE_URL=https://.../v1 LODE_EVAL_MODEL=... LODE_EVAL_KEY=... pnpm eval
 *
 * Search is off here, so corrections arrive without sources; we measure detection only.
 */
import { expect, it } from 'vitest';
import { parseOutput } from '@core/generation/validate';
import { OpenAiCompatibleAdapter } from '@core/llm/openaiCompatible';
import type { GenerationPoint } from '@core/llm/types';

const CASES: { point: GenerationPoint; wrong: boolean }[] = [
  {
    wrong: true,
    point: {
      id: 'p-wrong001',
      date: '2026-10-18',
      text: 'Server Components: In the App Router, components are Server Components by default. They render on the server and send HTML to the browser, which keeps bundles small. Because they run on the server, they can fetch data directly with async/await, and you can use useState and useEffect inside them for local state as long as you keep the component small. You only add "use client" when you want to opt out of server rendering entirely.',
    },
  },
  {
    wrong: true,
    point: { id: 'p-wrong002', date: '2026-10-18', text: 'Python dicts are unordered, so iteration order is random even in 3.12.' },
  },
  {
    wrong: false,
    point: { id: 'p-right001', date: '2026-10-18', text: 'FastAPI validates path parameters from their Python type hints.' },
  },
  {
    wrong: false,
    point: {
      id: 'p-right002',
      date: '2026-10-18',
      text: 'In Postgres, VACUUM marks space from dead tuples as reusable; VACUUM FULL rewrites the table and returns space to the OS.',
    },
  },
];

const env = (k: string): string => process.env[k] ?? '';

it.skipIf(!env('LODE_EVAL_BASE_URL'))('flags wrong points and leaves correct ones alone', async () => {
  const adapter = new OpenAiCompatibleAdapter({
    baseUrl: env('LODE_EVAL_BASE_URL'),
    model: env('LODE_EVAL_MODEL'),
    getKey: async () => env('LODE_EVAL_KEY'),
  });
  const runs = Number(env('LODE_EVAL_RUNS') || 3);
  let tp = 0;
  let fp = 0;
  const wrongTotal = CASES.filter((c) => c.wrong).length * runs;
  const rightTotal = CASES.filter((c) => !c.wrong).length * runs;
  for (let i = 0; i < runs; i++) {
    const res = await adapter.generate(
      { folderTitle: 'Dev notes', points: CASES.map((c) => c.point), subtopics: [] },
      { signal: AbortSignal.timeout(300_000), useSearch: false, maxSearches: 0 },
    );
    const parsed = parseOutput(res.json);
    const flagged = new Set(parsed.ok ? parsed.output.corrections.map((c) => c.pointId) : []);
    for (const c of CASES) {
      if (c.wrong && flagged.has(c.point.id)) tp++;
      if (!c.wrong && flagged.has(c.point.id)) fp++;
    }
    console.log(
      `run ${i + 1}: parsed=${parsed.ok} flagged=[${[...flagged].join(', ')}]` +
        (parsed.ok ? ` titles=${parsed.output.assignments.map((a) => JSON.stringify(a.subtopic.title)).join(' ')}` : ''),
    );
    if (parsed.ok) for (const c of parsed.output.corrections) console.log(`   ${c.pointId}: ${c.issue} -> ${c.correction}`);
  }
  console.log(`RESULT caught ${tp}/${wrongTotal} wrong, false alarms ${fp}/${rightTotal} correct`);
  expect(tp).toBeGreaterThan(0);
});
