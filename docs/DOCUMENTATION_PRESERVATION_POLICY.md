# Documentation Preservation Policy

This policy prevents documentation reconciliation from erasing agreed plans, history, or unrelated product domains. The default prompt field is `ALLOWED_DOCUMENT_REMOVALS: none`.

## Document classes and authority

- Planning documents: explicit agreed plans control future intent; later explicit decisions override only conflicting older assignments.
- Current-state documents: package metadata, implementation, CLI help, tests, and schemas control implemented facts.
- Historical documents: tags, releases, and chronological history control release facts; `CHANGELOG.md` is append-preserving.
- Mixed documents: classify each section independently as planning, current, historical, or deferred.

Implementation governs what is implemented. The roadmap governs what is planned. Published history governs release status. Reconciliation may repair status and facts; it may not infer cancellation from missing implementation.

## Deletion and reorganization rules

Without an explicit `ALLOWED_DOCUMENT_REMOVALS` allowlist, no agent may delete a roadmap version, planned feature, major section, release entry, command family, or architecture subsystem. Do not merge versions into ranges, reorder or rename versions, move features between versions, compress detailed plans, or convert individual plans into a generic deferred list without exact authorization.

## Reconciliation rules

Reconciliation updates current status, commands, and architecture while preserving plans, history, and unrelated domains. It is not permission to rewrite from scratch, summarize a whole file, derive future plans from code, or delete unimplemented plans. Every deletion must be reported.

## Required inventory

Before and after broad documentation work, capture headings, version headings, line/nonblank-line counts, and significant additions and deletions. Record provenance and the reason for every removed or reassigned section.

## Mandatory stop thresholds

Stop before commit when any roadmap version, future-plan section, release entry, or major project pillar disappears; a planning document loses more than 15 percent of nonblank lines; a document becomes a materially shorter summary; multiple unrelated domains disappear; or a structural deletion lacks explicit authorization.
