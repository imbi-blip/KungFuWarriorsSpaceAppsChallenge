// Fails the build if anything secret-looking ended up in the browser bundle.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
if (!existsSync(dist)) {
  console.error(`audit-bundle: ${dist} not found. Run "npm run build" first.`);
  process.exit(2);
}
const secretValues = ['GEMINI_API_KEY', 'FIRMS_MAP_KEY']
  .map((k) => process.env[k])
  .filter((v) => v && v.length >= 12 && !v.startsWith('MY_'));
const patterns = [
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/(?:api[_-]?key|map[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i, 'hard-coded credential'],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, 'private key'],
];
const findings = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = path.join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith('.map')) findings.push(`${p}: source map shipped (exposes source)`);
    else if (/\.(js|mjs|css|html|json|txt|svg)$/.test(name) && st.size < 20_000_000) {
      const text = readFileSync(p, 'utf8');
      for (const [re, label] of patterns) if (re.test(text)) findings.push(`${p}: looks like a ${label}`);
      for (const v of secretValues) if (text.includes(v)) findings.push(`${p}: contains a configured secret value`);
    }
  }
};
walk(dist);
if (findings.length) {
  console.error('audit-bundle FAILED:\n' + findings.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('audit-bundle: no secrets or source maps found in', dist);
