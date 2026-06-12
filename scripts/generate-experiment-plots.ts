#!/usr/bin/env node
import { runGenerateExperimentPlotsCommand } from "../src/commands/generateExperimentPlotsCommand.js";
process.exitCode = await runGenerateExperimentPlotsCommand(process.argv.slice(2));
