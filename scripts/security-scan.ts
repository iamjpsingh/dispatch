#!/usr/bin/env bun
// scripts/security-scan.ts — advisory hardcoded-value scan (complements gitleaks + CodeQL).
// Scans apps/api/src for:
//   (a) potential hardcoded secrets: a secret-ish name assigned a long string literal
//       (env reads / getSecret / placeholders are excluded);
//   (b) long high-entropy literals (base64/hex) that may be embedded keys;
//   (c) R2 smell: user-facing-looking option lists hardcoded as const string arrays.
// Report-only signal: prints findings and exits 1 if any (a)/(b) hit (CI runs it advisory).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCAN_DIR = fileURLToPath(new URL('../apps/api/src', import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p)
  }
  return out
}

interface Finding { file: string; line: number; kind: string; detail: string }

const PLACEHOLDER = /process\.env|import\.meta|getSecret|getSecretOr|decrypt|encrypt|changeme|example|placeholder|your[_-]|<[^>]+>|\$\{|\.\.\.|z\.string|Schema|_KEY_|test|dummy/i
const SECRET_ASSIGN = /\b(secret|passwd|password|api[_-]?key|apikey|access[_-]?key|secret[_-]?access|auth[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*(['"`])((?:(?!\2).){12,})\2/i
const LONG_B64 = /(['"`])([A-Za-z0-9+/]{48,}={0,2})\1/
const LONG_HEX = /(['"`])([0-9a-fA-F]{48,})\1/
const R2_ARRAY = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\[([^\]]{20,})\]/

// User-facing-list name hints; program-structure names (PERMISSIONS, EVENT_TYPES…) are excluded.
const R2_NAME = /categor|label|option|industr|countr|timezone|gender|currency|topic|interest/i

const findings: Finding[] = []
const r2Notes: Finding[] = []

for (const file of walk(SCAN_DIR)) {
  const rel = file.slice(file.indexOf('apps/api/src'))
  const lines = readFileSync(file, 'utf-8').split('\n')
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (line.startsWith('//') || line.startsWith('*')) return
    const secret = SECRET_ASSIGN.exec(line)
    if (secret && !PLACEHOLDER.test(line)) {
      findings.push({ file: rel, line: i + 1, kind: 'hardcoded-secret?', detail: `${secret[1]} = "${secret[3].slice(0, 6)}…"` })
    }
    const b64 = LONG_B64.exec(line) || LONG_HEX.exec(line)
    if (b64 && !PLACEHOLDER.test(line)) {
      findings.push({ file: rel, line: i + 1, kind: 'long-literal?', detail: `${b64[2].slice(0, 10)}… (${b64[2].length} chars)` })
    }
    const arr = R2_ARRAY.exec(line)
    if (arr && R2_NAME.test(arr[1])) {
      const strings = (arr[2].match(/(['"])(?:(?!\1).)*\1/g) || []).length
      if (strings >= 5) r2Notes.push({ file: rel, line: i + 1, kind: 'R2-smell?', detail: `const ${arr[1]} = [ ${strings} literals ]` })
    }
  })
}

const fmt = (f: Finding) => `  ${f.file}:${f.line}  [${f.kind}]  ${f.detail}`

console.log(`\n=== Advisory security scan (${SCAN_DIR.replace(/.*\//, '…/')}) ===`)
if (findings.length) {
  console.log(`\nPotential hardcoded secrets / embedded keys (${findings.length}) — review each:`)
  findings.forEach((f) => console.log(fmt(f)))
} else {
  console.log('\nNo hardcoded-secret / long-literal candidates found.')
}
if (r2Notes.length) {
  console.log(`\nR2 smells (${r2Notes.length}) — verify these user-facing lists should be DB-driven (informational):`)
  r2Notes.forEach((f) => console.log(fmt(f)))
}
console.log('')

// Exit non-zero only on secret/key candidates so the advisory CI step flags them; R2 notes are informational.
process.exit(findings.length > 0 ? 1 : 0)
