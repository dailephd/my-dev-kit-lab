// Deterministic fake Codex/Claude provider for the packed-package agent-success acceptance gate. Acceptance-test
// infrastructure only: written outside the package, never a real provider, never billed. It consumes the prompt from
// STDIN, records what it observed, and answers from files the gate prepared (test-owned data), keyed by case,
// treatment mode and the provider's OWN invocation count, so a scenario like "attempt 1 fails, repair 1 succeeds" is a
// property of this process and not of the production plugin.
//
//   ASR_PACKED_STATE_DIR   directory where the provider records invocations and finds its scripted responses
//
// State layout (all names are `<caseId>.<mode>` or `<caseId>.any`):
//   responses/<key>.<n>.txt | <key>.default.txt   final answer text for invocation n of that case/treatment
//   responses/<key>.<n>.behavior.json | <key>.default.behavior.json
//        {"exitCode":1,"stderr":"..."}  fail like a provider that hit a limit
//        {"noUsage":true}               omit the provider token usage entirely
//   invocations.jsonl                    one record per invocation (provider, key, n, argv, cwd, stdin facts)
//   prompts/<key>.<n>.prompt.txt         the exact stdin text of invocation n
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function runProvider(providerId) {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    console.log(`${providerId} 1.0.0-fake`);
    process.exit(0);
  }
  const stateDir = process.env.ASR_PACKED_STATE_DIR;
  let stdin = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    stdin += chunk;
  });
  process.stdin.on("end", () => {
    const caseId = (/^Case ID: (.+)$/m.exec(stdin) ?? [])[1] ?? "unknown";
    const mode = (/^Context mode: (.+)$/m.exec(stdin) ?? [])[1] ?? "unknown";
    const key = `${caseId}.${mode}`;
    const promptsDir = path.join(stateDir, "prompts");
    mkdirSync(promptsDir, { recursive: true });
    const n = readdirSync(promptsDir).filter((name) => name.startsWith(`${key}.`) && name.endsWith(".prompt.txt")).length + 1;
    writeFileSync(path.join(promptsDir, `${key}.${n}.prompt.txt`), stdin, "utf8");
    appendFileSync(
      path.join(stateDir, "invocations.jsonl"),
      `${JSON.stringify({ provider: providerId, key, caseId, mode, n, argv: args, cwd: process.cwd(), stdinChars: stdin.length, repairHeader: (/^# Repair attempt (\d+) of (\d+)$/m.exec(stdin) ?? []).slice(1, 3).map(Number) })}\n`,
      "utf8"
    );

    const lookup = (suffix) => {
      for (const candidate of [`${key}.${n}`, `${caseId}.any.${n}`, `${key}.default`, `${caseId}.any.default`]) {
        const file = path.join(stateDir, "responses", `${candidate}${suffix}`);
        if (existsSync(file)) return readFileSync(file, "utf8");
      }
      return null;
    };
    const behavior = JSON.parse(lookup(".behavior.json") ?? "{}");
    if (behavior.exitCode) {
      process.stderr.write(behavior.stderr ?? "forced provider failure");
      process.exit(behavior.exitCode);
    }
    const response = lookup(".txt");
    if (response === null) {
      process.stderr.write("no scripted response");
      process.exit(3);
    }
    if (providerId === "codex") {
      console.log(JSON.stringify({ type: "thread.started" }));
      console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: response } }));
      if (behavior.noUsage !== true) console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 70, output_tokens: 30, total_tokens: 100 } }));
    } else {
      const envelope = { result: response, session_id: "fixture" };
      if (behavior.noUsage !== true) envelope.usage = { input_tokens: 60, output_tokens: 40 };
      console.log(JSON.stringify(envelope));
    }
    process.exitCode = 0;
  });
}
