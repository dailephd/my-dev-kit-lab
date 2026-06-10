import { runEvaluateTokenSavingsCommand } from "../src/commands/evaluateTokenSavings.js";

process.exitCode = await runEvaluateTokenSavingsCommand(process.argv.slice(2));
