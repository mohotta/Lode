import { describe, expect, it } from 'vitest';
import { tidyMarkdown } from '@shared/markdown';

describe('tidyMarkdown', () => {
  it('turns editor hard breaks into plain newlines', () => {
    expect(tidyMarkdown('first line  \nsecond line')).toBe('first line\nsecond line');
  });

  it('leaves trailing spaces inside code fences alone', () => {
    const md = 'Run:\n\n```bash\necho hi  \n```';
    expect(tidyMarkdown(md)).toBe(md);
  });

  it('trims surrounding whitespace and keeps plain text unchanged', () => {
    expect(tidyMarkdown('\n  ClusterIP is internal  \n')).toBe('ClusterIP is internal');
    expect(tidyMarkdown('Use `kubectl expose` here')).toBe('Use `kubectl expose` here');
  });
});
