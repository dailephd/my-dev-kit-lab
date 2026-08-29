#!/usr/bin/env node
import { runAuditCommandFromArgs } from "../../src/commands/runAuditCommand.js";
process.exitCode = await runAuditCommandFromArgs(process.argv.slice(2));
