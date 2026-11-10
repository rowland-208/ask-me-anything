import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CARDS, VIBES, randomSeed, shuffled, tilt } from './deck'
import type { Card } from './deck'

type Motion = 'none' | 'spring' | 'toss' | 'draw'
type Pose = { x: number; y: number; rot: number; scale: number; back: boolean; motion: Motion }
type Phase = 'idle' | 'drag' | 'busy'

const CENTER: Pose = { x: 0, y: 0, rot: 0, scale: 1, back: false, motion: 'spring' }
const TOSS_MS = 620
const DRAW_MS = 640
const SWIPE_PX = 80
const PILE_SHOWN = 4
const PILE_W = 76

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function initialSeed(): string {
  return new URLSearchParams(window.location.search).get('seed') || randomSeed()
}

function CardFront({ card, number }: { card: Card; number: number }) {
  const vibe = VIBES[card.vibe]
  return (
    <div className={`face front vibe-${card.vibe}`}>
      <div className="sticker">
        <span aria-hidden="true">{vibe.sticker}</span>
        {vibe.label}
      </div>
      <div className="body">
        {card.fact && (
          <p className="fact">
            <b>fun fact!</b> {card.fact}
          </p>
        )}
        <p className="question">{card.question}</p>
      </div>
      {card.nudge && <p className="nudge">↳ {card.nudge}</p>}
      <span className="corner">{number}</span>
    </div>
  )
}


function CardBack() {
  return (
    <div className="face back" aria-hidden="true">
      <div className="back-badge">
        <span>?</span>
      </div>
    </div>
  )
}

function App() {
  const [seed, setSeed] = useState(initialSeed)
  const [seedDraft, setSeedDraft] = useState(seed)
  const [pos, setPos] = useState(0)
  const [pose, setPose] = useState<Pose>({ ...CENTER, back: true, motion: 'none' })
  const [phase, setPhase] = useState<Phase>('busy')
  const [swiped, setSwiped] = useState(false)
  const [cardW, setCardW] = useState(300)

  const slotRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x0: number; y0: number } | null>(null)
  const timers = useRef<number[]>([])

  const order = useMemo(() => shuffled(seed, CARDS.length), [seed])
  const current = pos < order.length ? CARDS[order[pos]] : null
  const deckLeft = Math.max(0, order.length - pos - 1)
  const discards = order.slice(Math.max(0, pos - PILE_SHOWN), pos)

  // Keep pile cards rendered at exactly the same size as the big card,
  // just scaled down, so a tossed card lands seamlessly on the pile.
  useLayoutEffect(() => {
    const el = slotRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCardW(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, reducedMotion() ? 0 : ms))
  }, [])

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }, [])

  /** Where a pile sits relative to the big card, and how much to shrink. */
  const target = useCallback((pile: HTMLElement | null) => {
    const slot = slotRef.current
    if (!slot || !pile) return { x: 0, y: 0, scale: 0.3 }
    const a = slot.getBoundingClientRect()
    const b = pile.getBoundingClientRect()
    return {
      x: b.left + b.width / 2 - (a.left + a.width / 2),
      y: b.top + b.height / 2 - (a.top + a.height / 2),
      scale: b.width / a.width,
    }
  }, [])

  /** Lift the top card off the deck, flip it, and plop it in the middle. */
  const draw = useCallback(() => {
    const t = target(deckRef.current)
    setPhase('busy')
    setPose({ x: t.x, y: t.y, rot: -6, scale: t.scale, back: true, motion: 'none' })
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setPose({ ...CENTER, motion: 'draw' })
        later(() => setPhase('idle'), DRAW_MS)
      }),
    )
  }, [later, target])

  // Deal a fresh deck whenever the seed changes (and on first load).
  useEffect(() => {
    clearTimers()
    setPos(0)
    draw()
    const url = new URL(window.location.href)
    url.searchParams.set('seed', seed)
    window.history.replaceState(null, '', url)
    return clearTimers
  }, [seed, draw, clearTimers])

  /** Swipe right: toss the card onto the discard pile and draw the next. */
  const toss = useCallback(() => {
    if (!current) {
      setPhase('idle')
      return
    }
    setPhase('busy')
    setSwiped(true)
    const t = target(discardRef.current)
    setPose({ x: t.x, y: t.y, rot: tilt(pos) + 360, scale: t.scale, back: false, motion: 'toss' })
    later(() => {
      setPos((p) => p + 1)
      if (pos + 1 < order.length) draw()
      else {
        setPose({ ...CENTER, motion: 'none' })
        setPhase('idle')
      }
    }, TOSS_MS)
  }, [current, draw, later, order.length, pos, target])

  /** Swipe left: put this card back on the deck and bring back the last discard. */
  const undo = useCallback(() => {
    if (pos === 0) {
      setPose({ ...CENTER })
      setPhase('idle')
      return
    }
    setPhase('busy')
    setSwiped(true)
    const unDiscard = () => {
      const t = target(discardRef.current)
      setPos((p) => p - 1)
      setPose({ x: t.x, y: t.y, rot: tilt(pos - 1), scale: t.scale, back: false, motion: 'none' })
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setPose({ ...CENTER, motion: 'draw' })
          later(() => setPhase('idle'), DRAW_MS)
        }),
      )
    }
    if (current) {
      const t = target(deckRef.current)
      setPose({ x: t.x, y: t.y, rot: -360, scale: t.scale, back: true, motion: 'toss' })
      later(unDiscard, TOSS_MS)
    } else unDiscard()
  }, [current, later, pos, target])

  const swipe = (x: number) => (x > 0 ? toss() : undo())

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== 'idle') return
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY }
    setPhase('drag')
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const x = e.clientX - d.x0
    const y = e.clientY - d.y0
    // Only grab the pointer once it really moves, so taps still reach buttons.
    if (Math.hypot(x, y) > 8 && !e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (!current) return // the empty spot doesn't move, it just listens for a left swipe
    setPose({ x, y, rot: x * 0.08, scale: 1.04, back: false, motion: 'none' })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const x = e.clientX - d.x0
    const y = e.clientY - d.y0
    if (Math.abs(x) > SWIPE_PX && Math.abs(x) > Math.abs(y)) swipe(x)
    else {
      setPose({ ...CENTER })
      setPhase('idle')
    }
  }

  // Keyboard swiping, for laptops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'idle' || e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowRight' || e.key === ' ') toss()
      else if (e.key === 'ArrowLeft') undo()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, toss, undo])

  const newSeed = () => {
    let next = randomSeed()
    while (next === seed) next = randomSeed()
    setSeedDraft(next)
    setSeed(next)
  }

  const commitSeed = () => {
    const next = seedDraft.trim() || randomSeed()
    setSeedDraft(next)
    if (next !== seed) setSeed(next)
  }

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }

  const pileStyle = { width: PILE_W, height: PILE_W * 1.4 }
  const pileCardStyle = (rot: number) => ({
    width: cardW,
    transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${PILE_W / cardW})`,
  })

  return (
    <main className="app">
      <header className="top">
        <h1 className="logo">
          ask me <span>anything</span>
        </h1>
        <form
          className="seed"
          onSubmit={(e) => {
            e.preventDefault()
            commitSeed()
            ;(document.activeElement as HTMLElement | null)?.blur()
          }}
        >
          <span aria-hidden="true">🎲</span>
          <input
            aria-label="Shuffle seed"
            value={seedDraft}
            spellCheck={false}
            onChange={(e) => setSeedDraft(e.target.value)}
            onBlur={commitSeed}
          />
        </form>
      </header>

      <section className="stage">
        <div className="slot" ref={slotRef}>
          {current ? (
            <div
              className={`fly-x m-${pose.motion} ${phase === 'drag' ? 'lifted' : ''}`}
              style={{ transform: `translateX(${pose.x}px)` }}
            >
              <div
                className="fly-y"
                style={{ transform: `translateY(${pose.y}px) rotate(${pose.rot}deg) scale(${pose.scale})` }}
                {...dragHandlers}
              >
                <div className="flip" style={{ transform: `rotateY(${pose.back ? 180 : 0}deg)` }}>
                  <CardFront card={current} number={order[pos] + 1} />
                  <CardBack />
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-spot" {...dragHandlers}>
              <p>that's the whole deck!</p>
              <button
                type="button"
                className="new-seed"
                onClick={newSeed}
              >
                <span aria-hidden="true">🎲</span> new seed
              </button>
            </div>
          )}
        </div>
        <p className={`hint ${swiped ? 'gone' : ''}`}>swipe right for the next card, left to undo</p>
      </section>

      <section className="table">
        <div className="pile-wrap">
          <div className="pile deck" ref={deckRef} style={pileStyle} key={`deck-${seed}`}>
            <div className="pile-outline" />
            {Array.from({ length: Math.min(deckLeft, 5) }, (_, i) => (
              <div
                key={i}
                className="pile-card"
                style={{ ...pileCardStyle(0), marginTop: -i * 2.5, marginLeft: -i * 1 }}
              >
                <CardBack />
              </div>
            ))}
          </div>
          <span className="pile-label">deck · {deckLeft}</span>
        </div>

        <div className="pile-wrap">
          <div className="pile" ref={discardRef} style={pileStyle}>
            <div className="pile-outline" />
            {discards.map((idx, i) => {
              const n = pos - discards.length + i
              return (
                <div key={n} className="pile-card" style={pileCardStyle(tilt(n))}>
                  <div className={n === pos - 1 ? 'landed' : undefined}>
                    <CardFront card={CARDS[idx]} number={idx + 1} />
                  </div>
                </div>
              )
            })}
          </div>
          <span className="pile-label">discard · {pos}</span>
        </div>
      </section>
    </main>
  )
}

export default App
