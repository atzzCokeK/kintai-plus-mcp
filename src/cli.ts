#!/usr/bin/env node
import { createNodeIO } from './cli/io.ts';
import { runCli } from './cli/main.ts';

const io = createNodeIO();
const code = await runCli(process.argv.slice(2), {
  io,
  startServer: async () => {
    throw new Error('MCP server is not implemented yet (T6)');
  },
});
io.close();
process.exitCode = code;
