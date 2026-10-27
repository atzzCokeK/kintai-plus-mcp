#!/usr/bin/env node
import { createNodeIO } from './cli/io.ts';
import { runCli } from './cli/main.ts';
import { startServer } from './server/start.ts';

const io = createNodeIO();
const code = await runCli(process.argv.slice(2), { io, startServer });
io.close();
if (code !== 0) process.exitCode = code;
