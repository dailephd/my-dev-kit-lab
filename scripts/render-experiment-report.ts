import { runRenderExperimentReportCommand } from "../src/commands/renderExperimentReportCommand.js";

process.exitCode = await runRenderExperimentReportCommand(process.argv.slice(2));
