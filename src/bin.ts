#!/usr/bin/env node
// ABOUTME: Executable entry point for the bambu-hando command.
// ABOUTME: Kept separate from cli.ts so tests can import main() without side effects.

import { main } from "./cli.js";

process.exitCode = await main(process.argv.slice(2));
