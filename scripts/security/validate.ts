#!/usr/bin/env node
import { runSecurityValidationCommandFromArgs } from "../../src/commands/runSecurityValidationCommand.js";
process.exitCode = await runSecurityValidationCommandFromArgs(process.argv.slice(2));
