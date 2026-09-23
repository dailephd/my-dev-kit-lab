# Coding-Agent Engineering Benchmark Plan

## Document status

Status: **planning / design reference; not implemented**

Owner: **my-dev-kit-lab**

Related coordinated roadmap family: **LAB-AGENT**

Historical roadmap relationship:
- the standalone Lab roadmap originally reserved the agent-success work under `v0.9.0-v0.9.2`;
- `my-dev-kit/docs/ECOSYSTEM_COORDINATED_ROADMAP.md` later proposes re-sequencing that unimplemented family to `my-dev-kit-lab v0.13.0-v0.13.2 / LAB-AGENT`;
- this document does not itself change either roadmap or assign a release version;
- implementation should follow the coordinated roadmap that is current when work begins and preserve the historical mapping rather than rewriting prior plans.

This document defines the intended architecture and implementation direction for generalized deterministic coding-agent evaluation. It is deliberately separate from `ROADMAP.md` so the design can be refined without turning every design detail into a version commitment.

---

## 1. Purpose

The goal is to extend my-dev-kit-lab from context/retrieval experiments into a generalized framework for evaluating how well a coding agent performs real software-engineering tasks.

The desired evaluation must be:

- deterministic in its verification logic;
- evidence-first and auditable;
- independent of subjective LLM judging;
- capable of evaluating real repository edits, not only textual answers;
- safe to run against controlled local benchmark copies;
- able to distinguish agent failure from infrastructure/provider failure;
- able to compare coding agents while holding the task and verification contract fixed;
- able to compare workflow/context treatments while holding the coding agent fixed;
- compatible with the existing my-dev-kit ecosystem ownership boundaries.

The benchmark should characterize whether an agent produces software that satisfies an explicit engineering contract. It should not try to directly score vague concepts such as “intelligence,” “clean code,” or “elegance.”

The central benchmark question is:

> How reliably does a coding agent produce a candidate implementation that satisfies a preregistered engineering contract under deterministic verification?

---

## 2. Relationship to existing work

### 2.1 Existing Lab foundation

The current Lab already provides useful pieces:

- a generic experiment plugin registry and runner;
- case / variant / outcome / artifact models;
- controlled real-agent adapters for Codex and Claude;
- deterministic fake-agent infrastructure;
- report generation;
- safe output separation from external targets;
- stage-context expectation fixtures;
- explicit `available` / `unavailable` / `not-applicable` semantics;
- target immutability snapshots;
- repeated-run determinism infrastructure;
- security-validation and audit owners;
- warm-index and context-strategy experiments.

The generalized benchmark should extend these owners rather than create a second experiment runner or a parallel report system.

### 2.2 Observer v0.6 comparative-study lessons

The my-frontend-observer v0.6 implementation experiment established several useful experimental principles:

- use independent branches/worktrees/sessions for experimental arms;
- freeze the candidate before cross-arm adjudication;
- retain the original failed measurement rather than rewriting history;
- model a rescue as a descendant candidate;
- preserve telemetry and provenance;
- distinguish product defects from workflow/process effects;
- use deterministic adversarial invariants rather than an opinionated code review.

Those principles should be carried into the generalized Lab benchmark.

### 2.3 Existing agent-success roadmap seed

The historical Lab `agent-success-rate` roadmap already proposed:

- running agents on implementation tasks;
- capturing changed files;
- executing benchmark tests;
- tracking expected and unexpected edits;
- preserving diffs;
- blast-radius metrics;
- repair attempts;
- real-agent campaigns on guarded copies.

This plan extends that idea into a richer deterministic engineering-contract model.

---

## 3. Design thesis

Do not define a universal “code quality score.”

Instead define a set of explicit, machine-verifiable requirements.

A coding agent performs well when it reliably:

1. implements the requested behavior;
2. preserves existing behavior;
3. follows explicit user constraints;
4. integrates with the repository’s established architecture;
5. avoids introducing security regressions;
6. handles hidden edge and failure cases;
7. stays within justified change scope;
8. produces results consistently across repeated independent runs.

These dimensions should remain individually visible.

A benchmark case may define an overall binary engineering-contract result:

```text
ENGINEERING_CONTRACT_SATISFIED =
    every required requirement == satisfied
```

This is not a weighted score. It is a deterministic conjunction over case-defined mandatory requirements.

---

## 4. Core architecture

```text
CodingAgentBenchmarkCaseV1
        |
        +-- public task
        +-- baseline repository identity
        +-- execution policy
        +-- private VerificationPlanV1
                         |
                         v
                 isolated workspace
                         |
                         v
                    coding agent
                         |
                         v
                  FREEZE CANDIDATE
                         |
         +---------------+----------------+
         |               |                |
         v               v                v
   diff/snapshot    verification      telemetry
                         |
          +--------------+---------------------------+
          |              |             |             |
          v              v             v             v
      behavior      instructions   architecture    security
          |              |             |             |
          +--------------+-------------+-------------+
                         |
                         v
                  requirement results
                         |
                         v
             EngineeringContractResultV1
                         |
                         v
                campaign aggregation
```

Critical boundary:

> The coding agent must finish and the candidate must be frozen before hidden verification begins.

The agent must not have filesystem access to private oracle material.

---

## 5. Public case versus private oracle

Each benchmark case should be split into two physical domains.

### 5.1 Agent-visible material

Example:

```text
benchmarks/
  cases/
    task-deduplication/
      public-case.json
      task.md

  projects/
    task-workflow-medium-ts/
      ...
```

The agent may see:

- the repository fixture;
- the public task;
- normal repository documentation;
- visible tests that are intentionally part of the task environment.

### 5.2 Evaluator-only material

Example:

```text
benchmarks/
  verification/
    task-deduplication/
      verification-plan.json
      hidden-tests/
      architecture-contract.json
      security-contract.json
      oracle-manifest.json
```

The coding agent must not receive this directory.

Do not rely on prompt instructions such as “do not read the hidden tests.” The files should not exist inside the agent workspace.

---

## 6. Proposed benchmark-case contract

A possible first contract shape:

```ts
type CodingAgentBenchmarkCaseV1 = {
  schemaVersion: "1.0.0";

  caseId: string;
  title: string;
  benchmarkProject: string;

  baseline: {
    fixtureRoot: string;
    subjectDigest: string;
    expectedCleanGitState: boolean;
  };

  publicTask: {
    prompt: string;
    taskLocality:
      | "localized"
      | "cross-module"
      | "broad-change";
    tags: string[];
  };

  execution: {
    timeoutMs: number;
    allowedNetwork: false;
    maxAttempts: number;
    workspaceMode: "copy";
  };

  verificationPlanRef: string;

  repeatPolicy: {
    recommendedRuns: number;
  };
};
```

The private verification plan reference must resolve outside the workspace copied to the agent.

Closed validation should reject unknown fields unless the contract revision explicitly permits them.

---

## 7. Reuse the coordinated evidence foundation

The coordinated ecosystem roadmap proposes generic evidence and verification contracts before the agent benchmark family.

The agent benchmark should consume those shared concepts instead of defining agent-specific replacements:

- `SubjectIdentityV1`
- `EnvironmentIdentityV1`
- `EvidenceEnvelopeV1`
- `EvidenceRequirementV1`
- `VerificationPlanV1`
- `VerificationRecordV1`
- `EvidenceRequirementEvaluationV1`

The agent benchmark should add only agent/candidate-specific contracts where necessary.

A requirement result should use explicit states such as:

- `satisfied`
- `failed`
- `missing`
- `unavailable`
- `stale`
- `incompatible`
- `incomplete`
- `not-applicable`
- `unevaluated-optional`

Missing or unavailable evidence must never be converted to a numeric zero or an implicit pass.

---

## 8. Candidate identity and immutability

A commit SHA alone is insufficient.

A candidate identity should include at least:

- benchmark case ID;
- baseline subject identity;
- baseline source digest;
- candidate source digest;
- changed-file manifest digest;
- dependency/lockfile digest when applicable;
- trial ID;
- agent identity/version;
- treatment ID;
- verification-plan digest.

For external repositories, include relevant dirty tracked and untracked source state rather than assuming the commit alone fully identifies the subject.

Once the candidate is frozen:

- evaluators may read it;
- evaluators may execute commands against it;
- evaluators must not rewrite source;
- any repair produces a new descendant candidate identity.

---

## 9. Workspace-editing agent execution contract

The existing `AgentAdapter` is primarily answer-oriented: it sends a prompt and parses textual output.

Do not break that interface.

Add a sibling implementation-agent abstraction.

Possible shape:

```ts
type ImplementationAgentRunRequest = {
  runId: string;
  agentId: string;
  promptText: string;
  workspaceRoot: string;
  artifactRoot: string;
  timeoutMs: number;
  environmentPolicy: AgentEnvironmentPolicy;
};

type ImplementationAgentRunResult = {
  runId: string;
  agentId: string;

  startedAt: string;
  completedAt: string;

  status:
    | "completed"
    | "failed"
    | "timeout"
    | "unavailable"
    | "limit-reached";

  exitCode: number | null;
  agentVersion: string | null;

  tokenUsage: AgentTokenUsage;

  stdoutRef?: string;
  stderrRef?: string;
  telemetryRef?: string;
};
```

The execution result must not contain self-reported correctness or quality fields. Verification belongs to Lab evaluators.

---

## 10. Generic external-agent support

Built-in adapters may exist for:

- Codex;
- Claude;
- deterministic fixture/fake implementation agent.

A generic external CLI adapter should allow future coding agents without requiring a Lab release for every provider.

Possible configuration:

```ts
type ExternalImplementationAgentConfigV1 = {
  id: string;
  displayName: string;

  command: string;
  args: string[];

  promptPlaceholder: string;
  workspacePlaceholder?: string;

  availabilityCommand?: {
    command: string;
    args: string[];
  };
};
```

Provider-specific adapters remain useful when they expose richer telemetry.

---

## 11. Candidate workspace lifecycle

The benchmark must preserve the current Lab principle that the inspected/original external target is not modified.

Per trial:

```text
canonical benchmark fixture
            |
            v
    disposable candidate copy
            |
            v
      coding agent edits
            |
            v
      candidate frozen
            |
            v
        verification
            |
            v
        copy cleaned
```

Proposed shared module family:

```text
src/evaluation/candidateWorkspace/
    createCandidateWorkspace.ts
    captureCandidateSnapshot.ts
    compareCandidateSnapshots.ts
    freezeCandidate.ts
    cleanupCandidateWorkspace.ts
    types.ts
```

Before the agent runs, capture:

- file hashes;
- Git state;
- lockfile/dependency digest;
- source snapshot digest;
- environment identity.

After the agent runs, capture:

- changed files;
- added/deleted/renamed files;
- binary changes;
- dependency changes;
- candidate source digest;
- diff digest;
- candidate Git state.

---

## 12. Freeze the verification plan before execution

The private `VerificationPlanV1` must be frozen and hashed before the agent begins.

The trial manifest records:

```text
verificationPlanDigest
```

If the plan changes after the agent runs, the candidate must not be rescored as though nothing changed.

A materially changed oracle creates:

- a new benchmark-case revision;
- a new verification-plan digest;
- a new evaluation.

This prevents post-hoc weakening or strengthening of the benchmark to favor a result.

---

## 13. Evaluation dimensions

### 13.1 Functional correctness

Use hidden task-specific behavior tests.

For a well-formed task:

```text
baseline:
  task behavior test -> FAIL

candidate:
  task behavior test -> PASS
```

The baseline should be qualified before the case is accepted.

### 13.2 Regression safety

Existing canonical tests should pass before and after:

```text
baseline:
  regression test -> PASS

candidate:
  regression test -> PASS
```

A PASS-to-FAIL transition is a regression.

### 13.3 Instruction conformance

Translate explicit task constraints into machine-verifiable predicates.

Examples:

- no new dependency;
- do not change public API;
- do not modify migrations;
- only modify allowed paths;
- add tests;
- preserve a schema;
- preserve backward compatibility.

Do not ask an LLM whether instructions were followed.

### 13.4 Architecture conformance

Lab should evaluate architecture contracts using structural evidence supplied by the repository and, where applicable, my-dev-kit.

Possible deterministic predicates:

- existing owner must be used;
- forbidden dependency edge;
- required dependency edge;
- no new dependency cycle;
- public symbol must remain;
- public symbol must not move;
- no parallel owner;
- layer dependency rule;
- allowed change region.

Lab should not reimplement my-dev-kit graph ownership.

### 13.5 Security

Security should be evaluated as baseline-to-candidate evidence.

Report:

- introduced findings;
- resolved findings;
- unchanged findings;
- new required-policy violations.

Pre-existing findings must not automatically count against the agent.

Where suitable, add deterministic behavioral exploit probes such as:

- path traversal attempts;
- malformed input;
- subprocess argument injection;
- unsafe URL or redirect handling;
- unsafe file writes.

Reuse existing Lab security-validation owners rather than creating an agent-specific security scanner.

### 13.6 Robustness/generalization

Use hidden:

- edge cases;
- boundary conditions;
- malformed inputs;
- empty inputs;
- duplicate values;
- permutation tests;
- large-input tests;
- failure-path tests;
- property-based tests with fixed seeds;
- metamorphic tests where appropriate.

The purpose is to make narrow visible-test fitting insufficient.

### 13.7 Scope and blast radius

Hard scope rules may fail the contract when explicitly declared, for example:

- `migrations/**` must not change;
- package manifest must remain unchanged;
- schema files must remain unchanged.

Other blast-radius values are descriptive evidence:

- changed file count;
- lines added/deleted;
- modules affected;
- dependency neighborhoods changed;
- exported symbols added/removed.

Do not assume that a smaller diff is universally better.

### 13.8 Static quality evidence

Initially treat values such as these as evidence unless a case explicitly makes them requirements:

- lint delta;
- type-error delta;
- cycle delta;
- complexity delta;
- duplication delta;
- unused-export delta;
- dependency delta.

Do not calculate a universal “code quality score.”

### 13.9 Test quality

Do not build mutation/coverage/flakiness logic directly into the first agent benchmark version if the coordinated roadmap still reserves that work for the later test-quality family.

The agent benchmark should be able to consume test-quality evidence when that shared capability exists.

---

## 14. What “intelligent code” means operationally

The benchmark should not directly judge intelligence.

Instead, a strong coding implementation should succeed because it:

- understands the requested behavior;
- identifies the correct architectural owner;
- handles hidden cases;
- preserves existing contracts;
- does not create unnecessary parallel architecture;
- respects security boundaries;
- obeys user constraints;
- makes a bounded coherent change.

A useful benchmark task should sometimes omit the architectural answer from the public prompt while making the repository architecture clear enough that a capable agent can infer the proper implementation owner.

Example:

```text
Public request:
  Prevent duplicate imported tasks.
```

A shallow implementation may patch only `importTasks()`.

A stronger implementation may preserve the repository’s canonical data-integrity owner so all relevant creation paths inherit the invariant.

The hidden architecture and behavior oracle can distinguish these outcomes mechanically.

---

## 15. Benchmark corpus design

Start with a small certified corpus rather than hundreds of weak tasks.

Suggested initial size:

- approximately 12-20 cases;
- at least two benchmark projects;
- a mix of localized, cross-module, and broad-change tasks.

Suggested task families:

### A. Localized correctness

Measures:

- functional behavior;
- edge cases;
- regression safety.

### B. Cross-module ownership

Measures:

- architectural integration;
- owner reuse;
- generalization across entry points.

### C. API compatibility

Measures:

- requested behavior;
- public surface preservation;
- backward compatibility.

### D. Explicit instruction traps

Examples:

- implement without adding a dependency;
- preserve a schema;
- do not change migrations.

### E. Security-boundary tasks

Examples:

- safe path handling;
- safe subprocess argument handling;
- safe local URL handling.

### F. Broad-change negative controls

Cases where multiple modules legitimately must change.

These prevent the benchmark from encoding “small diff = better implementation.”

---

## 16. Deliberately tempting wrong implementations

For every benchmark case, identify the easiest locally-correct but globally-wrong implementation.

Then make the hidden oracle able to reject it.

Example:

```text
Task:
  Validate imported tasks.

Tempting wrong solution:
  validation only inside importTasks()

Architecturally correct behavior:
  shared validation owner enforces the rule

Hidden probe:
  exercise the same invariant through another entry path
```

This is a stronger way to test architectural reasoning than subjective code review.

---

## 17. Oracle certification

Every benchmark case should be self-tested before real-agent use.

At minimum maintain fixture variants:

```text
baseline
known-good
no-op
known-bad-functional
```

Where appropriate also include:

```text
architecture-violating
security-violating
instruction-violating
```

The benchmark verification gate should prove:

```text
baseline:
  existing tests PASS
  requested new behavior FAILS

known-good:
  all required requirements SATISFIED

no-op:
  requested behavior FAILS

architecture mutant:
  obvious feature tests may PASS
  architecture requirement FAILS

security mutant:
  obvious feature tests may PASS
  security requirement FAILS
```

A benchmark case whose oracle cannot distinguish these known states should not be admitted to the real-agent corpus.

---

## 18. Repeated-run reliability

Agents are stochastic; the evaluator should not require byte-identical source patches.

For each case, run the same configuration independently multiple times:

```text
same agent
same version
same baseline
same task
same treatment
same tool permissions
same budget
N independent trials
```

Report outcome reproducibility:

```text
functional satisfied:    5/5
instruction satisfied:   5/5
architecture satisfied:  4/5
security satisfied:      5/5
full contract satisfied: 4/5
```

Patch diversity may be reported descriptively:

- unique candidate digests;
- unique changed-file sets;
- diff-size distribution.

Do not treat patch diversity itself as pass/fail.

---

## 19. First attempt versus repair

Preserve the Observer v0.6 rescue principle.

First attempt:

```text
baseline
   |
   v
agent
   |
   v
candidate A
   |
   v
freeze
   |
   v
evaluate
```

If candidate A fails, retain that result.

Optional repair:

```text
candidate A
   |
   v
defined feedback
   |
   v
agent repair
   |
   v
candidate B
   |
   v
freeze
   |
   v
evaluate
```

Report separately:

```text
first-attempt result
repair-1 result
repair count
repair cost
```

Never collapse this to a single eventual PASS.

---

## 20. Controlled repair feedback

Potential repair modes:

- `no-feedback`
- `public-test-feedback`
- `requirement-category-feedback`
- `full-verifier-feedback`

These answer different research questions and must not be mixed silently.

Example:

`public-test-feedback` may expose only normal visible test output.

`requirement-category-feedback` may say that an architecture requirement failed without revealing the private predicate.

`full-verifier-feedback` may reveal the specific failed hidden requirement.

Record the feedback mode in trial identity.

---

## 21. Agent versus workflow treatments

Keep agent identity separate from treatment identity.

Agents:

```text
codex
claude
external-cli:<id>
fixture-agent
```

Treatments may include:

```text
native
my-dev-kit-context
orchestrated-context
combined-ecosystem
```

This enables two different studies with the same verifier.

### Coding-agent capability study

Hold constant:

- task;
- repository;
- verification plan;
- budget;
- treatment.

Change:

- agent.

Question:

> Which agents reliably satisfy the engineering contract?

### Workflow-intervention study

Hold constant:

- task;
- repository;
- verification plan;
- budget;
- agent.

Change:

- treatment.

Question:

> Does this workflow/context intervention improve the same agent’s engineering outcomes?

### Full factorial study

```text
case
x agent
x treatment
x repeat
```

Do not automatically wrap every coding-agent trial in my-dev-kit-orchestrator. Orchestrator belongs in the experiment only when orchestration is explicitly part of the treatment being tested.

---

## 22. Proposed experiment plugin

Preferred implementation name:

```text
agent-engineering-benchmark
```

Historical mapping:

```text
LAB-AGENT-01
historical standalone roadmap concept: agent-success-rate
implementation plugin: agent-engineering-benchmark
```

This avoids implying that agent quality is one scalar success-rate number while preserving roadmap history.

---

## 23. Proposed source layout

```text
src/
  experiments/
    plugins/
      agentEngineeringBenchmark/
        config.ts
        plugin.ts
        selection.ts
        execution.ts
        executionArtifact.ts
        metrics.ts
        resultMapping.ts
        types.ts
        index.ts

  agents/
    implementation/
      types.ts
      registry.ts
      runImplementationAgent.ts
      adapters/
        codexImplementationAdapter.ts
        claudeImplementationAdapter.ts
        externalCliImplementationAdapter.ts
        fixtureImplementationAdapter.ts

  evaluation/
    benchmarkCases/
      codingAgentBenchmarkCaseV1.ts
      readCodingAgentBenchmarkCases.ts
      validateCodingAgentBenchmarkCase.ts

    candidateWorkspace/
      createCandidateWorkspace.ts
      captureCandidateSnapshot.ts
      freezeCandidate.ts
      compareCandidateSnapshots.ts
      cleanupCandidateWorkspace.ts

    verification/
      executeVerificationPlan.ts
      evaluateRequirement.ts
      evaluateVerificationRecords.ts

    agentBenchmark/
      evaluateAgentCandidate.ts
      aggregateAgentTrials.ts
      calculateReliability.ts
```

Shared verification/evidence contracts should remain outside the agent plugin.

---

## 24. Proposed output layout

Every trial should be independently reviewable.

```text
lab-output/
  experiments/
    agent-engineering-benchmark/
      <run-id>/

        experiment-manifest.json

        cases/
          <case-id>/

            <agent-id>/
              trial-01/

                agent/
                  run.json
                  stdout.txt
                  stderr.txt
                  telemetry.json

                candidate/
                  baseline-snapshot.json
                  candidate-snapshot.json
                  changed-files.json
                  diff.patch
                  diff.sha256

                verification/
                  verification-plan-digest.json
                  records/
                    FUNC-001.json
                    REG-001.json
                    ARCH-001.json
                    SEC-001.json
                  evaluations.json
                  engineering-result.json
```

For public benchmark fixtures, full diff capture is acceptable.

For external/private repositories, full source-containing diffs should be opt-in. Default evidence should prefer bounded path/stat/hash metadata when full source preservation is unnecessary.

---

## 25. CLI direction

Extend the existing experiment family.

Conceptual future surface:

```text
my-dev-kit-lab experiment run   --experiment agent-engineering-benchmark   --cases <cases.json>   --agents codex,claude   --repeat 5   --out <dir>
```

Possible plugin-specific flags:

- `--case`
- `--benchmark-project`
- `--agents`
- `--repeat`
- `--timeout-ms`
- `--continue-on-failure`
- `--agent-config`
- `--capture-diff`
- `--repair-attempts`
- `--repair-feedback`

Do not create a new top-level `benchmark-agent` command unless the existing experiment framework proves inadequate.

Real workspace-editing agent execution must require explicit authorization. It must never happen as a hidden side effect of a read-only experiment command.

---

## 26. Reporting model

A single trial report should show requirement-level evidence.

Example:

| Requirement | Category | Result | Evidence |
| --- | --- | --- | --- |
| FUNC-001 | Functional | satisfied | hidden behavior tests passed |
| REG-001 | Regression | satisfied | baseline regression suite preserved |
| INSTR-001 | Instruction | satisfied | dependency manifest unchanged |
| ARCH-001 | Architecture | failed | expected owner not used; parallel owner added |
| SEC-001 | Security | satisfied | no new finding / exploit probe passed |
| SCOPE-001 | Scope | satisfied | forbidden paths untouched |

Summary:

```text
Required requirements:
  satisfied: 5
  failed:    1

Engineering contract:
  NOT SATISFIED
```

No weighted quality score is needed.

---

## 27. Campaign aggregation

Per agent/treatment, report dimension-level outcomes.

Example:

| Dimension | Satisfied trials | Applicable trials |
| --- | ---: | ---: |
| Functional | 93 | 100 |
| Regression | 97 | 100 |
| Instruction | 89 | 100 |
| Architecture | 78 | 100 |
| Security | 98 | 100 |
| Scope | 91 | 100 |
| Full engineering contract | 69 | 100 |

Also report:

- timeout count;
- unavailable-provider count;
- invalid/infrastructure run count;
- token availability and source;
- duration distribution;
- repair-attempt distribution.

Do not calculate a universal weighted score, winner, or ranking.

---

## 28. Infrastructure failure versus agent failure

These are distinct states and must remain distinct:

- agent produced an incorrect implementation;
- agent CLI unavailable;
- provider usage limit reached;
- agent timed out;
- candidate workspace creation failed;
- dependency installation failed;
- verifier crashed;
- required scanner unavailable;
- hidden test reporter malformed.

An unavailable evaluator must never become “zero findings.”

An unavailable agent must never become “agent failed the coding task.”

---

## 29. Suggested implementation staging

### Foundation: LAB-EVIDENCE-01

The coordinated roadmap currently places the generic evidence foundation before the agent family.

Required shared capabilities:

- `SubjectIdentityV1`
- `EnvironmentIdentityV1`
- `EvidenceEnvelopeV1`
- `EvidenceRequirementV1`
- `VerificationPlanV1`
- `VerificationRecordV1`
- `EvidenceRequirementEvaluationV1`
- safe command capture;
- artifact hashing;
- controlled target boundary;
- verification adapters.

This is not yet the coding-agent benchmark.

### LAB-AGENT-01: benchmark core

Implement:

- `CodingAgentBenchmarkCaseV1`;
- private-oracle separation;
- candidate workspace lifecycle;
- implementation-agent abstraction;
- fixture implementation agent;
- candidate freeze and diff capture;
- functional verifier;
- regression verifier;
- instruction verifier;
- scope verifier;
- basic architecture verifier;
- existing Lab security-evidence integration;
- `agent-engineering-benchmark` plugin;
- initial certified corpus;
- JSON / text / HTML reports.

### LAB-AGENT-02: campaigns and reliability

Implement:

- N independent trials;
- campaign resume;
- completed-trial skipping;
- provider/rate-limit status handling;
- agent version capture;
- normalized token telemetry;
- campaign manifests;
- paired-agent comparison;
- reproducibility summaries.

### LAB-AGENT-03: reporting and publication

Implement:

- campaign comparison report;
- dimension plots;
- stability plots;
- failure-class plots;
- diff/blast-radius views;
- gallery integration;
- portable evidence bundle.

Still no universal winner or composite quality score.

### Later shared test-quality family

When the coordinated test-quality capability is implemented, add:

- coverage adapters;
- mutation testing;
- repeated-test flakiness evidence.

The agent benchmark should consume those records rather than creating a parallel implementation.

---

## 30. Proposed LAB-AGENT-01 implementation batches

A detailed first implementation sequence:

### Batch 1 — benchmark contract and private-oracle boundary

Freeze:

- `CodingAgentBenchmarkCaseV1`;
- public/private path rules;
- validators;
- fixture digests;
- verification-plan identity;
- known-good/no-op case certification contract.

### Batch 2 — candidate workspace lifecycle

Implement:

- disposable copy;
- baseline snapshot;
- subject identity;
- candidate freeze;
- changed-file manifest;
- diff digest;
- cleanup;
- proof original target remains untouched.

### Batch 3 — implementation-agent abstraction

Implement:

- workspace-editing request/result contracts;
- deterministic fixture implementation agent;
- Codex implementation adapter;
- Claude implementation adapter;
- external CLI adapter;
- provider/infrastructure outcome taxonomy.

### Batch 4 — verification execution core

Implement:

- frozen verification-plan reader;
- supported command/file/diff requirement execution;
- `VerificationRecordV1`;
- requirement evaluation;
- unavailable versus failed semantics.

### Batch 5 — functional and regression verification

Implement:

- hidden task tests;
- canonical regression tests;
- baseline qualification;
- FAIL-to-PASS requested-behavior evidence;
- PASS-to-PASS preservation evidence;
- PASS-to-FAIL regression evidence.

### Batch 6 — instruction and scope verification

Implement mechanical constraints such as:

- no new dependencies;
- preserve API/schema;
- required file/test changes;
- forbidden path changes;
- allowed change regions.

### Batch 7 — architecture verification

Implement deterministic architecture predicates using existing static evidence owners:

- required owner;
- forbidden edge;
- required edge;
- no new cycle;
- symbol preservation;
- layer constraints;
- no parallel owner where the case defines a machine-verifiable rule.

### Batch 8 — security integration

Implement:

- baseline/candidate security evidence diff;
- introduced/resolved finding classification;
- requirement-level security mapping;
- case-specific deterministic exploit probes.

### Batch 9 — experiment plugin

Implement:

- config;
- selection;
- agent/treatment matrix;
- run execution;
- outcome mapping;
- closed config validation;
- plugin registration;
- installed/source-checkout command integration.

### Batch 10 — reports and fixture campaign

Implement:

- JSON report;
- text report;
- HTML report;
- fake-agent positive/negative modes;
- full end-to-end deterministic campaign;
- packed-package proof.

### Batch 11 — guarded real-agent campaign

Run a small certified subset with Codex and Claude only after the harness itself is proven.

Preserve:

- exact tool versions;
- exact baseline;
- exact verification plan;
- independent workspaces;
- all partial outcomes.

### Batch 12 — documentation and methodology freeze

Reconcile:

- `ROADMAP.md`;
- `CURRENT_STATE.md`;
- `ARCHITECTURE.md`;
- `WORKFLOWS.md`;
- `METRICS.md`;
- `COMMANDS.md`;
- benchmark methodology;
- oracle revision policy;
- interpretation limitations.

Do not mark future capabilities as implemented.

---

## 31. Non-goals

The first generalized benchmark should not:

- use an LLM as the quality judge;
- produce a universal weighted “agent score”;
- rank agents by a hidden opinionated formula;
- equate fewer changed files with better engineering;
- expose hidden oracle files to the coding agent;
- silently repair failed candidates before recording the original result;
- mutate the canonical benchmark fixture;
- require my-dev-kit-orchestrator for every coding-agent run;
- duplicate my-dev-kit static-graph ownership;
- duplicate Lab security scanners;
- claim that unavailable evidence is zero;
- claim that benchmark success universally proves production readiness.

---

## 32. Success criteria for the framework

The generalized benchmark architecture is successful when it can demonstrate all of the following:

1. the same frozen case and verifier can evaluate multiple coding agents;
2. the same frozen case and verifier can evaluate multiple workflow/context treatments;
3. agents edit only disposable controlled copies;
4. hidden verification remains inaccessible during implementation;
5. known-good, no-op, architecture-violating, and security-violating fixtures produce the expected deterministic outcomes;
6. first-attempt and repair results remain separate;
7. architecture, security, instruction, functional, regression, and scope evidence remain individually inspectable;
8. infrastructure/provider failures are not mislabeled as coding failures;
9. repeated independent trials produce reproducibility statistics;
10. reports expose raw evidence and requirement outcomes without a subjective composite quality score.

---

## 33. Working terminology

Preferred terminology:

- **engineering contract** — the complete required verification contract for one benchmark case;
- **engineering-contract satisfaction** — all required requirements satisfied;
- **candidate** — one frozen repository state produced by one trial;
- **trial** — one independent agent × treatment × case execution;
- **treatment** — the workflow/context condition applied to an agent;
- **verification plan** — preregistered private evaluator contract;
- **requirement evaluation** — deterministic status for one requirement;
- **campaign** — a bounded set of repeated trials.

Avoid using “intelligence score” or “code quality score” as canonical metric names.

---

## 34. Final design position

The framework should characterize a coding agent by a multidimensional evidence profile rather than one opinionated number.

A representative profile may eventually report:

```text
Agent: <agent/version>
Treatment: native

Functional correctness       47 / 50 cases
Regression safety            49 / 50
Instruction conformance      46 / 50
Architecture conformance     44 / 50
Security conformance         50 / 50
Robustness / holdout         43 / 50
Full engineering contract    39 / 50

Repeated-run stability
  median satisfied trials    4 / 5

Efficiency
  duration                   ...
  tokens                     ...

No composite score.
```

The benchmark should therefore measure what matters directly:

> whether a coding agent can repeatedly produce correct, architecture-conforming, instruction-following, secure, regression-safe software under a frozen deterministic engineering contract.
