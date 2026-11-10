import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CARDS, VIBES, shuffled, tilt } from './deck'
import type { Card } from './deck'
import { toCode, useRoom } from './room'
import { SharePopup } from './Share'

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
  // The room holds the shared truth ({ seed, pos }). `seed` and `pos` below are
  // what this screen is showing; the animations catch them up to the room.
  const { room, snap } = useRoom(CARDS.length)
  const [seed, setSeed] = useState('')
  const [seedDraft, setSeedDraft] = useState<string | null>(null) // null = not editing
  const [pos, setPos] = useState(0)
  const [pose, setPose] = useState<Pose>({ ...CENTER, back: true, motion: 'none' })
  const [phase, setPhase] = useState<Phase>('idle')
  const [swiped, setSwiped] = useState(false)
  // Is the card on screen face down because someone else drew it?
  const [hidden, setHidden] = useState(false)
  const wantHidden = snap.drawer !== null && snap.drawer !== snap.me
  const [cardW, setCardW] = useState(300)
  const [modal, setModal] = useState<'roll' | 'share' | null>(null)

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

  /** Lift the top card off the deck and plop it in the middle, flipping it
   *  face up unless someone else drew it. */
  const draw = useCallback((hide: boolean) => {
    const t = target(deckRef.current)
    setPhase('busy')
    setHidden(hide)
    setPose({ x: t.x, y: t.y, rot: -6, scale: t.scale, back: true, motion: 'none' })
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setPose({ ...CENTER, back: hide, motion: 'draw' })
        later(() => setPhase('idle'), DRAW_MS)
      }),
    )
  }, [later, target])

  useEffect(() => clearTimers, [clearTimers])

  /** Swipe right: toss the card onto the discard pile (face up, for everyone)
   *  and draw the next. */
  const toss = useCallback((hideNext: boolean) => {
    if (!current) {
      setPhase('idle')
      return
    }
    setPhase('busy')
    setSwiped(true)
    setHidden(false)
    const t = target(discardRef.current)
    setPose({ x: t.x, y: t.y, rot: tilt(pos) + 360, scale: t.scale, back: false, motion: 'toss' })
    later(() => {
      setPos((p) => p + 1)
      if (pos + 1 < order.length) draw(hideNext)
      else {
        setPose({ ...CENTER, motion: 'none' })
        setPhase('idle')
      }
    }, TOSS_MS)
  }, [current, draw, later, order.length, pos, target])

  /** Swipe left: put this card back on the deck and bring back the last discard. */
  const undo = useCallback(() => {
    if (pos === 0) {
      setPose({ ...CENTER, back: hidden })
      setPhase('idle')
      return
    }
    setPhase('busy')
    setSwiped(true)
    const unDiscard = () => {
      const t = target(discardRef.current)
      setHidden(false) // back from the discard pile: everyone has seen it
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
  }, [current, hidden, later, pos, target])

  // Catch this screen up to the room: someone else swiped, the host corrected
  // us, or the seed changed. One step animates; bigger jumps just redeal.
  useEffect(() => {
    if (phase !== 'idle' || !snap.seed) return
    if (snap.seed !== seed) {
      setSeed(snap.seed)
      setPos(snap.pos)
      draw(wantHidden)
    } else if (snap.pos === pos + 1) toss(wantHidden)
    else if (snap.pos === pos - 1) undo()
    else if (snap.pos !== pos) {
      setPos(snap.pos)
      draw(wantHidden)
    } else if (hidden !== wantHidden && current) {
      // Same card, but who can see it changed (e.g. the drawer left): flip it.
      setHidden(wantHidden)
      setPose({ ...CENTER, back: wantHidden, motion: 'draw' })
    }
  }, [phase, snap.seed, snap.pos, seed, pos, hidden, wantHidden, current, toss, undo, draw])

  /** A swipe on this device: animate right away and tell the room. */
  const swipe = (dir: 'next' | 'undo') => {
    if (dir === 'next' && current) {
      toss(false) // we drew it, so we get to see it
      room.act('next')
    } else if (dir === 'undo' && pos > 0) {
      undo()
      room.act('undo')
    } else {
      setPose({ ...CENTER, back: hidden })
      setPhase('idle')
    }
  }

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
    setPose({ x, y, rot: x * 0.08, scale: 1.04, back: hidden, motion: 'none' })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const x = e.clientX - d.x0
    const y = e.clientY - d.y0
    if (Math.abs(x) > SWIPE_PX && Math.abs(x) > Math.abs(y)) swipe(x > 0 ? 'next' : 'undo')
    else {
      setPose({ ...CENTER, back: hidden })
      setPhase('idle')
    }
  }

  const swipeRef = useRef(swipe)
  useLayoutEffect(() => {
    swipeRef.current = swipe
  })

  // Keyboard swiping, for laptops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal) {
        if (e.key === 'Escape') setModal(null)
        return
      }
      if (phase !== 'idle' || e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowRight' || e.key === ' ') swipeRef.current('next')
      else if (e.key === 'ArrowLeft') swipeRef.current('undo')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, phase])

  /** Rolling a new seed throws away the current deck, so always ask first. */
  const askNewSeed = () => setModal('roll')

  const newSeed = () => {
    setModal(null)
    room.rollNew()
  }

  /** The seed box is the room box: a typed code joins that room, or starts it. */
  const commitSeed = () => {
    const code = toCode(seedDraft ?? '')
    setSeedDraft(null)
    if (code) room.goTo(code)
  }

  const rollNote =
    snap.role === 'guest'
      ? "You'll leave this room and start a new deck of your own."
      : snap.people > 1
        ? 'Everyone here moves to the new deck with you.'
        : 'This shuffles up a brand new deck.'

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
          <button type="button" className="die" aria-label="Roll a new seed" onClick={askNewSeed}>
            🎲
          </button>
          <input
            aria-label="Shuffle seed and room code"
            value={seedDraft ?? snap.seed}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onFocus={() => setSeedDraft(snap.seed)}
            onChange={(e) => setSeedDraft(e.target.value)}
            onBlur={commitSeed}
          />
        </form>
        <button
          type="button"
          className={`share-btn status-${snap.status} ${snap.role}`}
          aria-label="Play together"
          onClick={() => setModal('share')}
        >
          <span aria-hidden="true">👥</span>
          {snap.people > 1 ? <b>{snap.people}</b> : <b>share</b>}
        </button>
      </header>

      <section className="stage">
        <div className="slot" ref={slotRef}>
          {!seed ? null : current ? (
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
                onClick={askNewSeed}
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
      {modal === 'share' && <SharePopup snap={snap} url={room.shareUrl} onClose={() => setModal(null)} />}
      {modal === 'roll' && (
        <div className="overlay" onClick={() => setModal(null)}>
          <div
            className="popup"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="popup-die" aria-hidden="true">🎲</div>
            <p id="confirm-title">Roll a new seed?</p>
            <p className="popup-note">{rollNote}</p>
            <div className="popup-buttons">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                nope
              </button>
              <button type="button" className="btn" onClick={newSeed} autoFocus>
                roll it!
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
