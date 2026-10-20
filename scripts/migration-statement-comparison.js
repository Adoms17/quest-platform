// Conservative lexical splitter for offline history comparison, never SQL execution.
// Keeps comments and literal bodies byte-for-byte after CRLF normalization.
export function splitMigrationStatements(input) {
  const sql = input.replaceAll('\r\n', '\n')
  const result = []
  let start = 0
  let i = 0
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2)
      i = end < 0 ? sql.length : end + 1
    } else if (sql.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2 }
        else if (sql.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth) throw new Error('Unclosed SQL comment')
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++]
      // Conservative: reject escaped strings instead of guessing server settings.
      let closed = false
      while (i < sql.length) {
        if (sql[i] === '\\' && [quote, '\\'].includes(sql[i + 1])) throw new Error('Ambiguous escape requires parser review')
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) i += 2
          else { i++; closed = true; break }
        } else i++
      }
      if (!closed) throw new Error('Unclosed SQL quote')
    } else if (sql[i] === '$' && (i === 0 || !/[A-Za-z0-9_$]/.test(sql[i - 1]))) {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (!tag) { i++; continue }
      const end = sql.indexOf(tag, i + tag.length)
      if (end < 0) throw new Error('Unclosed dollar quote')
      i = end + tag.length
    } else if (sql[i] === ';') {
      const statement = sql.slice(start, i).trim()
      if (statement) result.push(statement)
      start = ++i
    } else i++
  }
  const tail = sql.slice(start).trim()
  if (tail) result.push(tail)
  return result
}

// Local fingerprint CLI. This proves history content only, not current schema state.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { verifyProductionCandidate } from './verify-production-candidate-manifest.js'
export function statementFingerprint(statements) {
  return createHash('sha256').update(JSON.stringify(statements.map(value => value.replaceAll('\r\n', '\n').trim()))).digest('hex')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const { manifest, migrations } = verifyProductionCandidate(root)
  const rows = migrations.filter(item => item.version <= manifest.baselineMigration).map(item =>
    item.version + ':' + statementFingerprint(splitMigrationStatements(readFileSync(resolve(root, item.path), 'utf8'))))
  console.log(JSON.stringify({ count: rows.length, aggregate: createHash('sha256').update(rows.join('\n')).digest('hex'), scope: 'migration-history-only' }))
}
