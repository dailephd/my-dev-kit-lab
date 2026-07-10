# mixed-generated-vendor fixture

Current: a single real source file (`src/index.ts`) alongside
`generated/schema.ts`, `dist/index.js`, `build/Main.class`, and
`vendor/lib.py` -- files that live under path segments the existing
`projectInventory.ts` policy already classifies as generated/build-output/
vendor. Used to prove those files do not pollute source-facts collection
(role stays generated/build-output/vendor, not source/test) and are excluded
from `SourceFactsSnapshot.files` the same way `sourceFacts.test.ts`'s
existing vendor/generated test already proves for a single language.
