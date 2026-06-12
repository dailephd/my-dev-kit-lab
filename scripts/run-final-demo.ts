#!/usr/bin/env node
import { runFinalDemoCommand } from "../src/commands/runFinalDemoCommand.js";
process.exitCode = await runFinalDemoCommand(process.argv.slice(2));
