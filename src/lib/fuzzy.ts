// Fuzzy matching for the task / people pickers and quick find. Pure, no
// dependency. A query matches when each of its words is a subsequence of the
// text (in any order of words); the score rewards letters at word starts,
// runs of consecutive letters and early matches, so "lgn api" ranks
// "Login API" above "Long-running migration API".

export interface FuzzyMatch {
  score: number
  indices: number[] // positions in the original text, ascending
}

// Letters that do not decompose under NFD
const FOLD: Record<string, string> = { 'ł': 'l', 'đ': 'd', 'ø': 'o', 'ß': 's', 'æ': 'a', 'œ': 'o' }

// One comparable char per original char: lower case, accents dropped
function fold(text: string): string[] {
  const out: string[] = []
  for (const ch of text) {
    const low = ch.toLowerCase()
    const base = FOLD[low] ?? low.normalize('NFD').replace(/\p{M}/gu, '')
    // Keep one char per code point so indices line up with the original
    out.push(base[0] ?? low)
    if (ch.length === 2) out.push('') // astral char: two UTF-16 units
  }
  return out
}

const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c)

const BASE = 1
const WORD_START = 8
const CONSECUTIVE = 6
const FIRST_CHAR = 4
const GAP = 0.15 // per skipped char between two matched letters
const LEAD = 0.05 // per char before the first match

// Best alignment of one query word inside the text (DP over positions)
function matchWord(word: string[], text: string[], starts: boolean[]): FuzzyMatch | null {
  const m = word.length
  const n = text.length
  if (!m) return { score: 0, indices: [] }
  if (m > n) return null
  // score[i][j]: best score with word[i] matched at text[j]; -Infinity = none
  const score: Float64Array[] = []
  const back: Int32Array[] = []
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(n).fill(-Infinity)
    const bk = new Int32Array(n).fill(-1)
    // Best of score[i-1][k] + GAP * k over k < j - 1 (gap penalty folded in)
    let best = -Infinity
    let bestK = -1
    for (let j = 0; j < n; j++) {
      if (i > 0 && j >= 2) {
        const k = j - 2
        const v = score[i - 1][k] + GAP * k
        if (v > best) { best = v; bestK = k }
      }
      if (text[j] !== word[i]) continue
      const bonus = BASE + (starts[j] ? WORD_START : 0) + (j === 0 ? FIRST_CHAR : 0)
      if (i === 0) {
        row[j] = bonus - LEAD * j
        continue
      }
      let prev = -Infinity
      let from = -1
      if (j >= 1 && score[i - 1][j - 1] > -Infinity) {
        prev = score[i - 1][j - 1] + CONSECUTIVE
        from = j - 1
      }
      if (bestK >= 0) {
        const gapped = best - GAP * (j - 1)
        if (gapped > prev) { prev = gapped; from = bestK }
      }
      if (from < 0) continue
      row[j] = prev + bonus
      bk[j] = from
    }
    score.push(row)
    back.push(bk)
  }
  let end = -1
  let top = -Infinity
  for (let j = 0; j < n; j++) if (score[m - 1][j] > top) { top = score[m - 1][j]; end = j }
  if (end < 0) return null
  const indices: number[] = []
  for (let i = m - 1, j = end; i >= 0; j = back[i][j], i--) indices.push(j)
  indices.reverse()
  return { score: top, indices }
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { score: 0, indices: [] }
  const t = fold(text)
  // t is indexed by UTF-16 unit, like `text`
  const starts = t.map((c, j) => {
    if (!c) return false
    if (j === 0) return true
    const prev = t[j - 1] || ''
    if (!isWordChar(prev)) return true
    // camelCase boundary in the original text
    const cur = text[j]
    const before = text[j - 1]
    return cur !== cur.toLowerCase() && before === before.toLowerCase() && before !== before.toUpperCase()
  })
  const joined = t.join('')
  // joined drops the empty second halves of astral chars: map back to t
  const joinedAt: number[] = []
  t.forEach((c, j) => { if (c) joinedAt.push(j) })
  let score = 0
  const all = new Set<number>()
  for (const w of words) {
    const fw = fold(w).filter(Boolean)
    const r = matchWord(fw, t, starts)
    if (!r) return null
    score += r.score
    // A contiguous hit beats letters scattered over several words, most of
    // all at a word start
    const at = joined.indexOf(fw.join(''))
    if (at >= 0) score += 2 + fw.length * 2 + (starts[joinedAt[at]] ? 4 : 0)
    for (const i of r.indices) all.add(i)
  }
  // Shorter texts win ties: the match covers more of them
  score -= t.length * 0.01
  return { score, indices: [...all].sort((a, b) => a - b) }
}

export interface Ranked<T> {
  item: T
  match: FuzzyMatch
}

// The items matching `query`, best first (input order breaks ties). An empty
// query keeps every item in input order.
export function fuzzyFilter<T>(items: readonly T[], query: string, textOf: (item: T) => string, limit = Infinity): Ranked<T>[] {
  if (!query.trim()) return items.slice(0, limit).map(item => ({ item, match: { score: 0, indices: [] } }))
  const out: Array<Ranked<T> & { i: number }> = []
  items.forEach((item, i) => {
    const match = fuzzyMatch(query, textOf(item))
    if (match) out.push({ item, match, i })
  })
  out.sort((a, b) => b.match.score - a.match.score || a.i - b.i)
  return out.slice(0, limit).map(({ item, match }) => ({ item, match }))
}

// Splits text into plain and matched runs, for highlighting
export function highlightRuns(text: string, indices: readonly number[]): Array<{ text: string; hit: boolean }> {
  const hits = new Set(indices)
  const chars = [...text]
  const runs: Array<{ text: string; hit: boolean }> = []
  let pos = 0
  for (const ch of chars) {
    const hit = hits.has(pos)
    const last = runs[runs.length - 1]
    if (last && last.hit === hit) last.text += ch
    else runs.push({ text: ch, hit })
    pos += ch.length === 2 ? 2 : 1
  }
  return runs
}
