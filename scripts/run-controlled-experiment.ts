import { runControlledExperimentCommand } from "../src/commands/runControlledExperimentCommand.js";

process.exitCode = await runControlledExperimentCommand(process.argv.slice(2));
