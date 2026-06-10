import { runCaptureDemoReportCommand } from "../src/commands/captureDemoReport.js";

const exitCode = await runCaptureDemoReportCommand(process.argv.slice(2));
process.exitCode = exitCode;
