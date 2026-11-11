import words from '../words.yaml'
import data from '../cards.yaml'

export type Vibe = 'whimsical' | 'deep' | 'nerdy' | 'spicy' | 'preference'

export type Card = {
  vibe: Vibe
  fact?: string
  question: string
  nudge?: string
  /** Two ends of a slider, for "where do you land?" cards. */
  scale?: [string, string]
}

export const VIBES: Record<Vibe, { sticker: string; label: string }> = {
  whimsical: { sticker: '🌈', label: 'whimsical' },
  deep: { sticker: '🌊', label: 'deep' },
  nerdy: { sticker: '🔭', label: 'nerdy' },
  spicy: { sticker: '🌶️', label: 'spicy' },
  preference: { sticker: '🎚️', label: 'preference' },
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
      scale:
        Array.isArray(c.scale) && c.scale.length === 2 && c.scale.every((x: unknown) => typeof x === 'string')
          ? (c.scale as [string, string])
          : undefined,
    }))
}

export const CARDS = loadCards()

export type DeckId = 'sfw' | 'spicy'

/** The decks you can pick on the start screen. Each is a list of card indices. */
export const DECKS: Record<DeckId, { label: string; blurb: string; cards: number[] }> = {
  sfw: {
    label: 'SFW',
    blurb: 'silly, deep & nerdy',
    cards: CARDS.flatMap((c, i) => (c.vibe === 'spicy' ? [] : [i])),
  },
  spicy: {
    label: 'Spicy',
    blurb: 'everything, plus 🌶️',
    cards: CARDS.map((_, i) => i),
  },
}

export const DECK_SIZES: Record<DeckId, number> = {
  sfw: DECKS.sfw.cards.length,
  spicy: DECKS.spicy.cards.length,
}

/** The deck's cards (as indices into CARDS) in this seed's shuffled order. */
export function dealOrder(seed: string, deck: DeckId): number[] {
  const pool = DECKS[deck].cards
  return shuffled(seed, pool.length).map((i) => pool[i])
}

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

function wordList(key: string): string[] {
  const list = words && typeof words === 'object' ? (words as Record<string, unknown>)[key] : null
  return Array.isArray(list) ? list.filter((w): w is string => typeof w === 'string' && /^[a-z]+$/.test(w)) : []
}

const ADJECTIVES = wordList('adjectives')
const ANIMALS = wordList('animals')

/** A friendly random seed like "tremendous-caribou" (~350k combinations). */
export function randomSeed(): string {
  const pick = (w: string[]) => w[Math.floor(Math.random() * w.length)]
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}`
}
