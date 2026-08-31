import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const mojibakeMarkers = [
  '\u0420\u045f',
  '\u0420\u040e',
  '\u0420\u0454',
  '\u0420\u00b0',
  '\u0420\u00b5',
  '\u0420\u00bb',
  '\u0420\u0405',
  '\u0421\u201a',
  '\u0421\u0453',
  '\u0421\u2039',
  '\u0421\u040f',
  '\u0421\u040a',
  '\u0421\u2021',
  '\u0421\u20ac',
]

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.js', '.jsx'].includes(extname(entry.name)) ? [path] : []
  })
}

describe('source encoding', () => {
  it('does not contain UTF-8 text decoded as Windows-1251', () => {
    const corrupted = sourceFiles('src').filter(path => {
      const source = readFileSync(path, 'utf8')
      return mojibakeMarkers.some(marker => source.includes(marker))
    })

    expect(corrupted).toEqual([])
  })
})
