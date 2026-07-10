import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    testTimeout: 30_000,
    // v0.3.4 pre-release-readiness correction -- tests/audits/ and
    // tests/security/ contain many real-CLI integration tests
    // (execFileSync-based, some 20-40s each: auditSecurityIntegration.test.ts,
    // auditCommandSmoke.test.ts, securityReportSchemaStability.test.ts, ...)
    // that synchronously block a forked worker's event loop for extended
    // periods. Vitest's default 10s teardownTimeout was occasionally too
    // short for such a worker to flush its final RPC messages before the
    // main process gave up, surfacing as an intermittent
    // "[vitest-worker]: Timeout calling \"onTaskUpdate\"" runner-stability
    // error (a worker/orchestrator RPC ack timeout, not a real test
    // failure -- see node_modules/vitest/dist/chunks/rpc.-pEldfrD.js).
    // Raising this is the standard, coverage-preserving mitigation: it does
    // not skip, weaken, or remove any test, and does not mask a genuine
    // test failure (a real assertion failure still fails immediately,
    // independent of this timeout).
    teardownTimeout: 30_000,
  },
});
