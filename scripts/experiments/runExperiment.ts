#!/usr/bin/env node
import { runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
process.exitCode = await runExperimentRunCommandFromArgs(process.argv.slice(2));
