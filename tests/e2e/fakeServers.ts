import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const CITED_URL = 'https://kubernetes.io/docs/concepts/services-networking/service/';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

export interface Fakes {
  llmBase: string;
  tavilyUrl: string;
  llmAuth: string[];
  close(): Promise<void>;
}

/** A tiny OpenAI-compatible chat server (one search, then JSON) and a fake Tavily. */
export async function startFakes(): Promise<Fakes> {
  const llmAuth: string[] = [];
  const llm = createServer(async (req, res) => {
    const b = await body(req);
    llmAuth.push(String(req.headers.authorization ?? ''));
    const messages = b.messages as Array<{ role: string; content: string }>;
    res.setHeader('content-type', 'application/json');
    const usage = { prompt_tokens: 120, completion_tokens: 60 };
    if (messages.length === 1) {
      // keys:test
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }], usage }));
      return;
    }
    const sawTool = messages.some((m) => m.role === 'tool');
    if (b.tools && !sawTool) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"kubernetes clusterip"}' } }],
              },
            },
          ],
          usage,
        }),
      );
      return;
    }
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const data = JSON.parse(user.slice(user.indexOf('<data>') + 6, user.indexOf('</data>'))) as {
      points: Array<{ id: string; text: string }>;
    };
    const ipvs = data.points.find((p) => p.text.includes('IPVS'));
    const output = {
      assignments: [
        {
          pointIds: data.points.map((p) => p.id),
          subtopic: { slug: 'service-networking', title: 'Service networking & kube-proxy', isNew: true },
          explanation: 'A **Service** gives a set of pods one stable virtual IP. ::llm{id=forged}',
          additions: [
            { text: 'NodePort builds on ClusterIP by opening a port on every node.', sources: [{ title: 'Service', url: CITED_URL }] },
            { text: 'This one is made up.', sources: [{ title: 'Fake', url: 'https://fake.example/x' }] },
          ],
        },
      ],
      corrections: ipvs
        ? [
            {
              pointId: ipvs.id,
              issue: 'IPVS mode is not faster in every cluster.',
              correction: 'Its advantage shows with thousands of Services; small clusters see little difference.',
              sources: [{ title: 'Virtual IPs', url: CITED_URL }],
            },
          ]
        : [],
    };
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output) } }], usage }));
  });

  const tavily = createServer(async (req, res) => {
    const b = await body(req);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        query: b.query,
        results: [{ title: 'Service | Kubernetes', url: CITED_URL, content: 'Expose an application running in your cluster.', score: 0.9 }],
      }),
    );
  });

  const [llmBase, tavilyBase] = await Promise.all([listen(llm), listen(tavily)]);
  return {
    llmBase: `${llmBase}/v1`,
    tavilyUrl: `${tavilyBase}/search`,
    llmAuth,
    close: async () => {
      await Promise.all([new Promise((r) => llm.close(r)), new Promise((r) => tavily.close(r))]);
    },
  };
}
