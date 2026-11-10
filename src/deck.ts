import { adjectives, animals } from 'unique-names-generator'
import data from '../cards.yaml'

export type Vibe = 'whimsical' | 'deep' | 'nerdy' | 'spicy'

export type Card = {
  vibe: Vibe
  fact?: string
  question: string
  nudge?: string
}

export const VIBES: Record<Vibe, { sticker: string; label: string }> = {
  whimsical: { sticker: '🌈', label: 'whimsical' },
  deep: { sticker: '🌊', label: 'deep' },
  nerdy: { sticker: '🔭', label: 'nerdy' },
  spicy: { sticker: '🌶️', label: 'spicy' },
}

function loadCards(): Card[] {
  if (!Array.isArray(data)) return []
  return data
    .filter((c) => c && typeof c.question === 'string')
    .map((c) => ({
      vibe: c.vibe in VIBES ? c.vibe : 'whimsical',
      fact: typeof c.fact === 'string' ? c.fact : undefined,
      question: c.question,
      nudge: typeof c.nudge === 'string' ? c.nudge : undefined,
    }))
}

export const CARDS = loadCards()

/** String -> 32-bit hash (cyrb53, folded). */
function hash(str: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  return h1 >>> 0
}

/** Small seeded PRNG (mulberry32). */
function rng(seed: string) {
  let a = hash(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic shuffle of card indices for a given seed. */
export function shuffled(seed: string, count: number): number[] {
  const rand = rng(seed)
  const order = Array.from({ length: count }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/** A jaunty, repeatable tilt for a card resting on a pile. */
export function tilt(i: number): number {
  return ((hash(`tilt${i}`) % 2400) / 100) - 12
}

// The library's word lists are broad. These words make a bad (or just odd)
// first impression as your room name: insults, sad or scary words, politics,
// religion, identity, and a few fragments like "inc" and "ltd".
const SKIP_ADJECTIVES = new Set(`
  absent accused acute adverse afraid aggressive alleged alone angry annoyed anxious
  appalling armed arrogant ashamed awful bad bitter blind bloody broken capitalist
  christian chronic chubby clinical colonial communist condemned conservative criminal
  crazy creepy crooked crude cruel damaged dangerous dead deaf deafening defeated
  democratic depressed desperate dirty disabled disappointed disastrous disgusted
  disturbed disturbing dreadful drunk dutch dying elderly electoral embarrassed
  embarrassing envious ethnic evil fat fatal female feminist filthy foolish frail
  frightened furious gay grieving grim gross grotesque guilty handicapped harsh
  helpless homeless hon horrible hostile hurt ideological ill illegal inadequate
  inappropriate inc injured jealous latin liberal lonely lost ltd mad male married
  marxist mean mental miserable misleading moaning naked nasty negative nervous
  obnoxious orthodox painful panicky parliamentary political poor pregnant presidential
  protestant psychiatric quarrelsome racial religious repulsive retired rotten rude sad
  scared scornful selfish severe sexual shocked sick skinny slimy socialist sore sorry
  soviet stupid suspicious tasteless terrible thoughtless tory toxic tragic troubled
  ugliest ugly unconscious unemployed unfair unfortunate unhappy unpleasant unsightly
  upset useless vicious violent vulnerable weak wicked worried worrying wrong
  xenophobic yucky zoophagous
`.split(/\s+/))
const SKIP_ANIMALS = new Set(`
  bedbug booby canidae felidae galliform hookworm leech louse roundworm xerinae
`.split(/\s+/))
const ADJECTIVES = adjectives.filter((w) => !SKIP_ADJECTIVES.has(w))
const ANIMALS = animals.filter((w) => !SKIP_ANIMALS.has(w))

/** A friendly random seed like "tremendous-caribou" (~350k combinations). */
export function randomSeed(): string {
  const pick = (w: string[]) => w[Math.floor(Math.random() * w.length)]
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}`
}
