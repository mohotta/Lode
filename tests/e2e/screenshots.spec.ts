import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { removeDir } from '../helpers';
import { launch, type Launched } from './launch';

// Regenerates assets/screenshots from a seeded demo vault. Not part of the normal run:
//   LODE_SCREENSHOTS=1 pnpm test:e2e tests/e2e/screenshots.spec.ts
test.skip(!process.env.LODE_SCREENSHOTS, 'set LODE_SCREENSHOTS=1 to regenerate the README screenshots');

const OUT = 'assets/screenshots';
let l: Launched;

const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const SERVICE = 'https://kubernetes.io/docs/concepts/services-networking/service/';
const PROBES = 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/';
const STAMP = '2026-10-20T09:00:00.000Z';

const llm = (id: string, body: string, attrs = ''): string => `::llm{id=${id} model="gpt-5-mini" at="${STAMP}"${attrs}}\n${body}\n::`;
const backlog = (date: string, entries: Array<[string, string]>): string =>
  `---\ndate: ${date}\ndeleted: []\n---\n${entries.map(([text, id]) => `- ${text} ^${id}`).join('\n')}\n`;

async function folder(root: string, slug: string, title: string, days: Record<string, Array<[string, string]>>): Promise<void> {
  for (const sub of ['backlog', 'notes', 'articles']) await mkdir(join(root, slug, sub), { recursive: true });
  await writeFile(join(root, slug, 'folder.json'), JSON.stringify({ title, createdAt: '2026-09-01T00:00:00.000Z' }));
  for (const [date, entries] of Object.entries(days)) await writeFile(join(root, slug, 'backlog', `${date}.md`), backlog(date, entries));
}

async function seed(root: string): Promise<void> {
  await folder(root, 'kubernetes', 'Kubernetes', {
    [day(0)]: [['Readiness probes gate traffic; liveness probes restart the container', 'p-k8sprobe']],
    [day(1)]: [['kube-proxy IPVS mode is always faster than iptables', 'p-k8sipvs0']],
    [day(7)]: [
      ['A headless Service (`clusterIP: None`) returns pod IPs from DNS', 'p-k8shdlss'],
      ['ClusterIP Services are only reachable from inside the cluster', 'p-k8sclust'],
    ],
  });
  await folder(root, 'postgresql', 'PostgreSQL', {
    [day(2)]: [['EXPLAIN ANALYZE actually runs the query, so wrap writes in a transaction you roll back', 'p-pgexplan']],
    [day(30)]: [['A partial index only covers rows matching its WHERE clause', 'p-pgpartial']],
  });
  await folder(root, 'rust', 'Rust', {
    [day(3)]: [['`?` converts the error with `From`, so one function can return many error types', 'p-rsquesti']],
  });

  await writeFile(
    join(root, 'kubernetes', 'notes', 'service-networking.md'),
    `---\nfolder: kubernetes\nsubtopic: service-networking\ntitle: Service networking & kube-proxy\nupdated: ${STAMP}\n---\n` +
      [
        '{{point:p-k8sclust}}',
        '{{point:p-k8shdlss}}',
        llm(
          'b-svc00001',
          `A **Service** gives a changing set of pods one stable virtual IP and DNS name. ClusterIP is the default type; kube-proxy on every node programs the rules that send traffic for that IP to a ready pod. A headless Service skips the virtual IP entirely, which suits StatefulSets that need to reach specific pods.\n\nAlso worth knowing:\n\n- NodePort builds on ClusterIP by opening the same port on every node. [Service](${SERVICE})\n- Services select pods by label, so a typo in a selector silently leaves the Service with no endpoints. [Service](${SERVICE})`,
        ),
        '{{point:p-k8sipvs0}}',
        llm(
          'b-svc00002',
          `IPVS is not faster in every cluster.\n\n**Correct:** its advantage shows with thousands of Services, where iptables rule lists grow long; small clusters see little difference. [Virtual IPs and Service proxies](${SERVICE})`,
          ' kind=correction for=p-k8sipvs0',
        ),
      ].join('\n\n') +
      '\n',
  );
  await writeFile(
    join(root, 'kubernetes', 'notes', 'probes-container-health.md'),
    `---\nfolder: kubernetes\nsubtopic: probes-container-health\ntitle: Probes & container health\nupdated: ${STAMP}\n---\n` +
      [
        '{{point:p-k8sprobe}}',
        llm('b-prb00001', `A failing **readiness** probe removes the pod from Service endpoints without restarting it; a failing **liveness** probe makes the kubelet restart the container. Add a **startup** probe for slow-booting apps so liveness does not kill them early. [Configure probes](${PROBES})`),
      ].join('\n\n') +
      '\n',
  );
  await writeFile(
    join(root, 'kubernetes', 'articles', 'cluster-networking.md'),
    `---\nfolder: kubernetes\narticle: cluster-networking\ntitle: Cluster networking\nupdated: ${STAMP}\nsubtopics:\n  - service-networking\n  - probes-container-health\ntopics: []\n---\n` +
      [
        llm('b-art00001', `Traffic reaches a pod only if a Service selects it and its readiness probe passes. This note ties the two together. [Service](${SERVICE})`),
        '{{point:p-k8sclust}}',
        '{{point:p-k8sprobe}}',
      ].join('\n\n') +
      '\n',
  );
}

test.beforeEach(async () => {
  l = await launch({}, { allowWeakKeyStorage: true }, seed, 'Learning');
  await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900));
  await l.page.waitForTimeout(500);
});
test.afterEach(async () => {
  await l.app.close();
  await removeDir(l.vaultRoot);
  await removeDir(l.userData);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`note ${scheme}`, async () => {
    const { page } = l;
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('.tree-item', { hasText: 'Kubernetes' }).click();
    await page.getByRole('button', { name: /Service networking/ }).first().click();
    await expect(page.getByRole('region', { name: 'Service networking & kube-proxy' })).toBeVisible();
    await page.screenshot({ path: join(OUT, `note-${scheme}.png`) });
  });
}

test('search dark', async () => {
  const { page } = l;
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.keyboard.press('Control+k');
  await page.getByRole('searchbox', { name: 'Search points and notes' }).fill('service');
  await expect(page.getByRole('list', { name: 'Matching points' }).getByRole('button').first()).toBeVisible();
  await page.screenshot({ path: join(OUT, 'search-dark.png') });
});

test('review light', async () => {
  const { page } = l;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: /^Review/ }).click();
  await expect(page.getByRole('heading', { name: /About a week ago/ })).toBeVisible();
  await page.screenshot({ path: join(OUT, 'review-light.png') });
});

test('notes cards light', async () => {
  const { page } = l;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('.tree-item', { hasText: 'Kubernetes' }).click();
  await expect(page.getByRole('list', { name: 'Notes' })).toBeVisible();
  await page.screenshot({ path: join(OUT, 'notes-light.png') });
});
