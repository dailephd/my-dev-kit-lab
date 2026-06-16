import { runLabDemoCommand } from "../src/commands/runLabDemo.js";

const exitCode = await runLabDemoCommand(process.argv.slice(2));
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
