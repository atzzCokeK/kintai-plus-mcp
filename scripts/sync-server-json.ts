/**
 * server.json（MCP Registry）のバージョンを package.json に合わせる。
 * `changeset version` の後に実行する（pnpm version-packages）。
 */
interface ServerJson {
  version: string;
  packages?: Array<{ version?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export function syncServerJson<T extends ServerJson>(server: T, pkg: { version: string }): T {
  return {
    ...server,
    version: pkg.version,
    ...(server.packages
      ? { packages: server.packages.map((p) => ({ ...p, version: pkg.version })) }
      : {}),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const server = JSON.parse(await readFile('server.json', 'utf8'));
  await writeFile('server.json', `${JSON.stringify(syncServerJson(server, pkg), null, 2)}\n`);
  process.stderr.write(`server.json -> ${pkg.version}\n`);
}
