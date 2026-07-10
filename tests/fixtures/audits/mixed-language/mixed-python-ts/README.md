# mixed-python-ts fixture

Current: a Python module (`src/app.py`) and a TypeScript module
(`src/index.ts`) that both declare an equivalent `add` function/declaration,
plus one Python test file. Used to prove Python and TypeScript source facts
coexist without schema or ordering drift, and that a duplicate-name
declaration across languages is not merged into a single cross-language
candidate.
