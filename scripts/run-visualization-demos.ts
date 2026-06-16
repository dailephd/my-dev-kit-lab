#!/usr/bin/env node
import { runVisualizationDemosCommand } from "../src/commands/runVisualizationDemosCommand.js";
process.exitCode = await runVisualizationDemosCommand(process.argv.slice(2));
