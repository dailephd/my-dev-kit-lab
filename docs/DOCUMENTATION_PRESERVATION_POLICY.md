# Documentation Preservation Policy

This policy prevents documentation work from erasing agreed plans, release history, command and workflow families, architecture domains, product pillars, limitations, or safety boundaries. Documentation recovery is a historical merge: implementation proves what exists, external release evidence proves what is published, and the roadmap preserves future intent.

## Document classes and canonical roles

| Document | Canonical role |
|---|---|
| `README.md` | User value, installation, first quickstart, capability summary, limitations, links, and one concise release note |
| `claude.txt` / `agents.txt` | Active coding-agent baseline, boundaries, retrieval workflow, validation expectations, and roadmap handoff |
| `docs/PROJECT_OVERVIEW.md` | Product thesis, users, use cases, companion relationships, capability areas, evidence model, and boundaries |
| `docs/CURRENT_STATE.md` | Package/release baseline, active version, branch/workflow state when relevant, implementation state, blockers, validation, and exact next action |
| `docs/ARCHITECTURE.md` | Current ownership, components, flows, contracts, invariants, extension points, and failure boundaries |
| `docs/COMMANDS.md` | Implemented commands, flags, defaults, allowed values, outputs, exit behavior, and safe examples |
| `docs/WORKFLOWS.md` | Goals, prerequisites, ordered procedures, decisions, outputs, failures, and completion states |
| `docs/ROADMAP.md` | Every agreed version, goal, scope, dependencies, exclusions, acceptance criteria, and concise status |
| `CHANGELOG.md` | Append-preserving published release chronology and user-visible changes |
| `docs/TUTORIAL.md` | One current first-use path, expected outputs, interpretation, troubleshooting, and next steps |
| `docs/METRICS.md` | Metric names, formulas, units, missing-data rules, caveats, and interpretation |
| `docs/GALLERY.md` | Gallery artifacts, relationships, build/use procedure, and limitations |
| `docs/security-validation-framework.md` | Threat assumptions, automated checks, evidence/finding semantics, mutation/network policy, verdicts, and limits |

Content may be summarized outside its canonical document only when the summary links back and does not introduce a second source of truth. Roadmap planning must not become a release diary, command manual, current architecture inventory, validation transcript, or implementation-batch log.

## Authority hierarchy

Use evidence in this order:

1. later explicit approved roadmap/workflow decisions;
2. npm, Git tags, GitHub Releases, merged pull requests, and exact Git history for publication state;
3. `package.json` and `package-lock.json` for identity/version;
4. current implementation and scripts;
5. CLI help and safe command output;
6. tests, fixtures, schemas, and generated report output;
7. the comprehensive roadmap for future scope;
8. `CHANGELOG.md`, verified against release evidence;
9. current then historical documentation;
10. inference only when evidence is unavailable.

One source category may correct another category's facts, but must not erase that category. Implementation controls current capability; release evidence controls publication; the roadmap controls planned scope; `CURRENT_STATE.md` controls operational state.

## Lifecycle vocabulary

- **Current/implemented:** code and safe runtime evidence prove the capability exists.
- **Planned:** approved future scope that is not implemented.
- **Historical/published:** release evidence proves the version or capability shipped; historical limitations remain valid inside their release context.
- **Deferred:** preserved intent without a committed release version. Deferred is not canceled.

Negated wording such as “not published” must never be parsed as a positive publication claim. Candidate or conceptual names must not appear as implemented syntax. `CandidateEvidence` is review evidence, never a confirmed vulnerability or `AuditIssue`. Automated security and Android validation are not manual pentesting.

## Allowed relocation and prohibited loss

Relocation is allowed only when the full meaning remains in a tracked canonical document, the source retains a concise link or summary when useful, and `reports/documentation-drift/relocation-ledger.txt` records source, destination, reason, and preservation evidence.

Unless explicitly allowlisted, do not delete or collapse documents, roadmap versions, future features, changelog releases, command families, workflow families, architecture domains, project pillars, limitations, invariants, or safety boundaries. Never replace individual roadmap versions with a range. Never shorten a comprehensive document into a materially smaller summary from memory.

Every documentation prompt must provide these fields; their default is `none`:

- `ALLOWED_DOCUMENT_REMOVALS`
- `ALLOWED_ROADMAP_VERSION_REMOVALS`
- `ALLOWED_FUTURE_FEATURE_REMOVALS`
- `ALLOWED_CHANGELOG_RELEASE_REMOVALS`
- `ALLOWED_COMMAND_FAMILY_REMOVALS`
- `ALLOWED_WORKFLOW_FAMILY_REMOVALS`
- `ALLOWED_ARCHITECTURE_DOMAIN_REMOVALS`
- `ALLOWED_PROJECT_PILLAR_REMOVALS`

## Before-and-after inventory

Before and after broad documentation work, record tracked user-facing documents, headings, roadmap versions and order, changelog releases, command/workflow/architecture families, nonblank-line counts, and additions/deletions. Record every contradiction decision and relocation. Generated forensic material belongs under ignored `reports/documentation-drift/` and must not be committed.

## Mandatory stop thresholds

Stop before commit when:

- any required roadmap version or release disappears;
- any command, workflow, architecture, capability, or project-pillar family disappears without explicit authorization;
- any limitation, non-destructive rule, network/process default, evidence distinction, or other safety boundary disappears;
- any document loses more than 15% of nonblank lines without a complete relocation ledger;
- comprehensive content becomes a materially shorter summary without authorization;
- a contradiction is hidden by weakening a check rather than correcting facts;
- before/after structural inventories or required removal allowlists are absent.

## Final report requirements

The final report must identify evidence and history inspected, source-of-truth decisions, complete version/release inventories, relocations, before/after metrics, exact validation results, files changed, ignored artifacts, Git state, unresolved ambiguity, and confirmation that product code, package/dependency versions, tags, releases, and publication were not changed.
