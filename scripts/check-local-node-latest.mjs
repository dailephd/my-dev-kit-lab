// Local-only Node check; hosted CI owns the supported Node 24 matrix.
const endpoint = "https://nodejs.org/dist/index.json";
let releases;
try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  releases = await response.json();
  if (!Array.isArray(releases)) throw new Error("Unexpected Node.js release index");
} catch (error) {
  console.error(`Cannot verify latest stable Node.js from ${endpoint}: ${String(error)}`);
  process.exit(1);
}
const stable = releases.filter(({ version }) => /^v[0-9]+[.][0-9]+[.][0-9]+$/.test(version));
const latest = stable[0]?.version;
if (!latest) { console.error("Node.js release index contains no stable versions"); process.exit(1); }
if (process.version !== latest) { console.error(`Local validation requires latest stable Node.js ${latest}; running ${process.version}. Upgrade Node and retry.`); process.exit(1); }
console.log(`Local Node.js: ${process.version} (latest stable)`);
