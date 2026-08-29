#!/usr/bin/env node
import { runExperimentListCommandFromArgs } from "../../src/commands/runExperimentListCommand.js";
process.exitCode = await runExperimentListCommandFromArgs(process.argv.slice(2));
