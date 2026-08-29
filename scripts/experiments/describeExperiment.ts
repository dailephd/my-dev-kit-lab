#!/usr/bin/env node
import { runExperimentDescribeCommandFromArgs } from "../../src/commands/runExperimentDescribeCommand.js";
process.exitCode = await runExperimentDescribeCommandFromArgs(process.argv.slice(2));
