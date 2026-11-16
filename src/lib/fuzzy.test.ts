import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyMatch, highlightRuns } from './fuzzy'

const names = (q: string, items: string[]) => fuzzyFilter(items, q, s => s).map(r => r.item)

describe('fuzzyMatch', () => {
  it('matches subsequences, case-insensitive', () => {
    expect(fuzzyMatch('lgn', 'Login page')).not.toBeNull()
    expect(fuzzyMatch('LOGIN', 'login page')).not.toBeNull()
    expect(fuzzyMatch('xyz', 'Login page')).toBeNull()
  })

  it('every word must match, in any order', () => {
    expect(fuzzyMatch('api log', 'Login API')).not.toBeNull()
    expect(fuzzyMatch('api zzz', 'Login API')).toBeNull()
  })

  it('ignores accents and Polish letters', () => {
    expect(fuzzyMatch('zolc', 'Żółć')).not.toBeNull()
    expect(fuzzyMatch('lodz', 'Łódź office')).not.toBeNull()
    expect(fuzzyMatch('cafe', 'Café')!.indices).toEqual([0, 1, 2, 3])
  })

  it('returns the matched positions', () => {
    expect(fuzzyMatch('dp', 'Deploy prod')!.indices).toEqual([0, 7])
  })

  it('an empty query matches everything with no positions', () => {
    expect(fuzzyMatch('  ', 'anything')).toEqual({ score: 0, indices: [] })
  })
})

describe('ranking', () => {
  it('word starts beat letters inside words', () => {
    expect(names('dp', ['Update', 'Deploy prod'])[0]).toBe('Deploy prod')
  })

  it('consecutive letters beat scattered ones', () => {
    expect(names('test', ['The east station', 'Integration tests'])[0]).toBe('Integration tests')
  })

  it('prefix beats a later match; shorter wins ties', () => {
    expect(names('des', ['Final design', 'Design'])[0]).toBe('Design')
    expect(names('api', ['API gateway setup', 'API'])[0]).toBe('API')
  })

  it('camelCase boundaries count as word starts', () => {
    expect(names('gc', ['logic', 'getConfig'])[0]).toBe('getConfig')
  })

  it('keeps input order without a query and honours the limit', () => {
    expect(names('', ['b', 'a', 'c'])).toEqual(['b', 'a', 'c'])
    expect(fuzzyFilter(['a1', 'a2', 'a3'], 'a', s => s, 2)).toHaveLength(2)
  })
})

describe('highlightRuns', () => {
  it('splits text into matched and plain runs', () => {
    expect(highlightRuns('Deploy prod', [0, 7])).toEqual([
      { text: 'D', hit: true }, { text: 'eploy ', hit: false }, { text: 'p', hit: true }, { text: 'rod', hit: false },
    ])
  })

  it('keeps emoji whole and positions aligned after them', () => {
    const text = '🚀 Launch'
    const m = fuzzyMatch('la', text)!
    const runs = highlightRuns(text, m.indices)
    expect(runs.map(r => r.text).join('')).toBe(text)
    expect(runs.filter(r => r.hit).map(r => r.text).join('')).toBe('La')
  })
})
