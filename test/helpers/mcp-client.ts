import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';

/** SDK のクライアントを使わずに、JSON-RPC を直接やり取りする最小のテスト用クライアント */
export interface TestClientOptions {
  capabilities?: Record<string, unknown>;
  /** サーバーからのリクエスト（elicitation/create など）に答える */
  onServerRequest?: (method: string, params: unknown) => unknown;
}

export async function connectTestClient(server: McpServer, options: TestClientOptions = {}) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  const serverRequests: Array<{ method: string; params: unknown }> = [];
  clientSide.onmessage = (message) => {
    const m = message as Record<string, unknown>;
    if (typeof m.method === 'string' && m.id !== undefined) {
      serverRequests.push({ method: m.method, params: m.params });
      const result = options.onServerRequest?.(m.method, m.params);
      void clientSide.send(
        (result === undefined
          ? { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported' } }
          : { jsonrpc: '2.0', id: m.id, result }) as never,
      );
      return;
    }
    if (typeof m.id === 'number' && pending.has(m.id)) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    }
  };
  await server.connect(serverSide);
  await clientSide.start();

  let nextId = 1;
  const request = (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId++;
    return new Promise<Record<string, unknown>>((resolve) => {
      pending.set(id, resolve);
      void clientSide.send({ jsonrpc: '2.0', id, method, params } as never);
    });
  };

  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: options.capabilities ?? {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  });
  await clientSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);

  return {
    init,
    serverRequests,
    request,
    async listTools() {
      const res = await request('tools/list');
      return (res.result as { tools: Array<Record<string, unknown>> }).tools;
    },
    async callTool(name: string, args: Record<string, unknown> = {}) {
      const res = await request('tools/call', { name, arguments: args });
      if (res.error) throw new Error(JSON.stringify(res.error));
      const result = res.result as { content: Array<{ text: string }>; isError?: boolean };
      const text = result.content.map((c) => c.text).join('');
      return { isError: result.isError === true, text, json: safeJson(text) };
    },
    close: () => clientSide.close(),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
