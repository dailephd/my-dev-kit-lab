import { runGeneratePromptVariantsCommand } from "../src/commands/generatePromptVariants.js";

process.exitCode = await runGeneratePromptVariantsCommand(process.argv.slice(2));
