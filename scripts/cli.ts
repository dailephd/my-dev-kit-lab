#!/usr/bin/env node
import { runLabCli } from "../src/cli/index.js";

try {
  process.exitCode = await runLabCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
