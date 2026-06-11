import { runAgentPromptCommand } from "../src/commands/runAgentPromptCommand.js";

process.exitCode = await runAgentPromptCommand(process.argv.slice(2));
