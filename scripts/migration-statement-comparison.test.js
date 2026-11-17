// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { splitMigrationStatements as split, statementFingerprint as hash } from './migration-statement-comparison.js'
describe('conservative migration statement comparison', () => {
  it('removes only separators and outer whitespace', () => {
    expect(split(' select 1;\r\n\r\n select 2;\r\n')).toEqual(['select 1', 'select 2'])
  })
  it('preserves quoted semicolons, doubled quotes and identifiers', () => {
    expect(split(`select 'a;it''s', "x;""y"; select 2;`)).toEqual([`select 'a;it''s', "x;""y"`, 'select 2'])
  })
  it('preserves dollar quoted bodies', () => {
    const statement = 'do $body$ begin perform 1; perform $$a;b$$; end; $body$'
    expect(split(statement + ';')).toEqual([statement])
  })
  it('preserves line and nested block comments', () => {
    expect(split('-- ;\n/* ; /* ; */ */ select 1;')).toEqual(['-- ;\n/* ; /* ; */ */ select 1'])
  })
  it('preserves regex backslashes', () => {
    expect(split(String.raw`select 'x\.y';`)).toEqual([String.raw`select 'x\.y'`])
  })
  it.each(["select 'x", 'select "x', 'do $$ x;', '/* x'])('rejects unclosed syntax %s', sql => {
    expect(() => split(sql)).toThrow()
  })
  it('rejects ambiguous escape handling', () => {
    expect(() => split(String.raw`select E'a\'b';`)).toThrow('Ambiguous escape')
  })
  it('never hides literal whitespace, case or statement order changes', () => {
    expect(hash(split("select 'a  b';"))).not.toBe(hash(split("select 'a b';")))
    expect(hash(split("select 'A';"))).not.toBe(hash(split("select 'a';")))
    expect(hash(split('select 1;select 2;'))).not.toBe(hash(split('select 2;select 1;')))
  })
  it('matches CRLF exports and LF files without collapsing internal whitespace', () => {
    expect(hash(['select\r\n  1'])).toBe(hash(split('select\n  1;\n')))
    expect(hash(['select\n  1'])).not.toBe(hash(['select\n 1']))
  })
})
