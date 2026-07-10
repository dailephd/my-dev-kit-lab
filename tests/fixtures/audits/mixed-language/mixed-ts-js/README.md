# mixed-ts-js fixture

Current: a minimal TypeScript entrypoint (`src/index.ts`) calling a plain
JavaScript helper (`src/helper.js`), with one test file. Used by
`tests/audits/mixedLanguageSourceFacts.test.ts` to prove TypeScript and
JavaScript files coexist in a single source-facts collection without schema
or ordering drift.
