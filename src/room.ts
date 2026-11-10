/**
 * Peer-to-peer rooms, no backend.
 *
 * The seed *is* the room code. Whoever registers `PREFIX + seed` with the
 * public PeerJS matchmaker is the host; everyone else connects to them
 * directly over WebRTC. The host owns the truth ({ seed, pos }) and
 * broadcasts it. Guests send swipes stamped with the card they swiped on,
 * and the host drops any that arrive late (someone else swiped first).
 *
 *   join-or-host: try to join the room; if nobody's there, host it.
 *   move:         when the host changes seed, guests follow to the new room.
 *   takeover:     if the host vanishes, guests re-run join-or-host, so one
 *                 of them becomes the new host and the others join them.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { DataConnection, Peer, PeerError } from 'peerjs'
import { randomSeed } from './deck'

const PREFIX = 'ask-me-anything-v1-'
const JOIN_TIMEOUT_MS = 8000
const TAKEOVER_TIMEOUT_MS = 2500 // the host is presumed gone, so don't wait long
// Everyone pings every 2s. A connection that's been silent for 7s is treated
// as gone; WebRTC on its own can take ages to notice a closed tab.
const PING_MS = 2000
const SILENT_MS = 7000

export type DeckState = { seed: string; pos: number }
export type Status = 'connecting' | 'live' | 'offline'
export type Snapshot = DeckState & { role: 'host' | 'guest'; status: Status; people: number }

type Msg =
  | { t: 'state'; seed: string; pos: number }
  | { t: 'swipe'; dir: 'next' | 'undo'; at: number }
  | { t: 'move'; room: string }
  | { t: 'ping' }
  | { t: 'bye' }

type Mode = 'join-or-host' | 'host-fresh'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Make any typed text into a valid room code: lowercase words joined by dashes. */
export function toCode(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

// Uses the free public PeerJS matchmaker. VITE_PEER_HOST points at a local
// one instead (e.g. `npx peer --port 9000` for testing).
const PEER_OPTS = import.meta.env.VITE_PEER_HOST
  ? { debug: 0, host: import.meta.env.VITE_PEER_HOST, port: 9000, path: '/', secure: false }
  : { debug: 0 }

async function openPeer(id?: string): Promise<Peer> {
  const { Peer } = await import('peerjs')
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, PEER_OPTS) : new Peer(PEER_OPTS)
    const done = () => {
      peer.off('open', onOpen)
      peer.off('error', onError)
    }
    const onOpen = () => {
      done()
      resolve(peer)
    }
    const onError = (e: PeerError<string>) => {
      done()
      peer.destroy()
      reject(e)
    }
    peer.on('open', onOpen)
    peer.on('error', onError)
  })
}

function connectTo(peer: Peer, id: string, timeoutMs: number): Promise<DataConnection> {
  return new Promise((resolve, reject) => {
    const conn = peer.connect(id, { serialization: 'json', reliable: true })
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs)
    const onError = (e: PeerError<string>) => finish(e)
    function finish(err?: unknown) {
      clearTimeout(timer)
      peer.off('error', onError)
      if (err) {
        conn.close()
        reject(err)
      } else resolve(conn)
    }
    conn.on('open', () => finish())
    peer.on('error', onError)
  })
}

const errType = (e: unknown) => (e && typeof e === 'object' && 'type' in e ? String(e.type) : '')

export class Room {
  private peer: Peer | null = null
  private host: DataConnection | null = null // set when we're a guest
  private guests: DataConnection[] = [] // set when we're the host
  private token = 0 // bumps on every enter(); stale async work checks it and bails
  private lastSeen = new Map<DataConnection, number>()
  private heartbeat = 0
  private listeners = new Set<() => void>()
  private deckSize: number
  snap: Snapshot

  constructor(deckSize: number) {
    this.deckSize = deckSize
    this.snap = { seed: '', pos: 0, role: 'host', status: 'connecting', people: 1 }
  }

  // ---- React glue ----------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  // ---- public API ----------------------------------------------------------

  start() {
    window.clearInterval(this.heartbeat)
    this.heartbeat = window.setInterval(() => this.beat(), PING_MS)
    const wanted = toCode(new URLSearchParams(window.location.search).get('room') ?? '')
    if (wanted) void this.enter(wanted, 'join-or-host')
    else void this.enter(randomSeed(), 'host-fresh')
  }

  stop() {
    // Say goodbye so the others react right away instead of waiting on the heartbeat.
    if (this.host) this.send(this.host, { t: 'bye' })
    this.guests.forEach((g) => this.send(g, { t: 'bye' }))
    this.token++
    window.clearInterval(this.heartbeat)
    this.teardown()
  }

  /** Typed a code: join that room if it's live, otherwise host it. */
  goTo(code: string) {
    if (code && code !== this.snap.seed) void this.enter(code, 'join-or-host')
  }

  /** Rolled the die: host a brand new room (anyone with us follows). */
  rollNew() {
    void this.enter(randomSeed(), 'host-fresh')
  }

  /** A swipe on this device. Applied right away; the host has the final say. */
  act(dir: 'next' | 'undo') {
    const { pos } = this.snap
    const next = dir === 'next' ? pos + 1 : pos - 1
    if (next < 0 || next > this.deckSize) return
    if (this.snap.role === 'guest' && this.host?.open) {
      this.set({ pos: next }) // optimistic
      this.send(this.host, { t: 'swipe', dir, at: pos })
    } else {
      this.set({ pos: next })
      this.broadcast()
    }
  }

  get shareUrl() {
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('room', this.snap.seed)
    return url.toString()
  }

  // ---- joining & hosting ---------------------------------------------------

  private async enter(code: string, mode: Mode, retries = 0, joinTimeout = JOIN_TIMEOUT_MS): Promise<void> {
    const token = ++this.token
    const stale = () => token !== this.token
    const old = { peer: this.peer, host: this.host, guests: this.guests }

    // Show the new deck immediately; if we end up joining, the host corrects pos.
    const pos = code === this.snap.seed ? this.snap.pos : 0
    this.set({ seed: code, pos, status: 'connecting', people: 1 })

    if (mode === 'join-or-host') {
      for (let attempt = 0; attempt <= retries; attempt++) {
        let peer: Peer | null = null
        try {
          peer = await openPeer()
          const conn = await connectTo(peer, PREFIX + code, joinTimeout)
          if (stale()) return void peer.destroy()
          this.handOff(old, code)
          return this.becomeGuest(peer, conn, code)
        } catch (e) {
          peer?.destroy()
          if (stale()) return
          const t = errType(e)
          if (t !== 'peer-unavailable' && !(e instanceof Error && e.message === 'timeout')) {
            return this.goOffline(old, code)
          }
        }
        if (attempt < retries) await sleep(700)
        if (stale()) return
      }
    }

    // Nobody's hosting `code` (or we asked for a fresh room): host it ourselves.
    try {
      const peer = await openPeer(PREFIX + code)
      if (stale()) return void peer.destroy()
      this.handOff(old, code)
      this.becomeHost(peer, code)
    } catch (e) {
      if (stale()) return
      if (errType(e) === 'unavailable-id') {
        // Someone grabbed it first. A random seed just rolls again;
        // a chosen code means there's a host now, so join them.
        if (mode === 'host-fresh') return this.enter(randomSeed(), 'host-fresh')
        return this.enter(code, 'join-or-host', 2, joinTimeout)
      }
      this.goOffline(old, code)
    }
  }

  /** Tell anyone who was with us where we went, then drop the old connections. */
  private handOff(old: { peer: Peer | null; host: DataConnection | null; guests: DataConnection[] }, code: string) {
    // Forget the old connections first, so hanging up isn't mistaken for the host vanishing.
    this.peer = null
    this.host = null
    this.guests = []
    old.guests.forEach((g) => this.send(g, { t: 'move', room: code }))
    old.host?.close()
    if (old.host) this.lastSeen.delete(old.host)
    old.guests.forEach((g) => this.lastSeen.delete(g))
    // Give the "move" message a moment to arrive before hanging up.
    setTimeout(() => {
      old.guests.forEach((g) => g.close())
      old.peer?.destroy()
    }, 400)
  }

  private becomeHost(peer: Peer, code: string) {
    this.peer = peer
    this.set({ role: 'host', status: 'live', people: 1 })
    this.setUrl(null)
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        // One entry per device, even if it reconnects.
        this.guests.filter((g) => g.peer === conn.peer && g !== conn).forEach((g) => this.dropGuest(g))
        if (!this.guests.includes(conn)) this.guests.push(conn)
        this.lastSeen.set(conn, Date.now())
        this.set({ people: this.guests.length + 1 })
        this.send(conn, { t: 'state', seed: code, pos: this.snap.pos })
      })
      conn.on('data', (d) => {
        this.lastSeen.set(conn, Date.now())
        this.onHostData(conn, d as Msg)
      })
      conn.on('close', () => {
        if (this.peer === peer) this.dropGuest(conn)
      })
    })
    this.keepAlive(peer)
  }

  private becomeGuest(peer: Peer, conn: DataConnection, code: string) {
    this.peer = peer
    this.host = conn
    this.set({ role: 'guest', status: 'live' })
    this.setUrl(code)
    this.lastSeen.set(conn, Date.now())
    conn.on('data', (d) => {
      this.lastSeen.set(conn, Date.now())
      const msg = d as Msg
      if (msg.t === 'state') this.set({ seed: msg.seed, pos: msg.pos })
      else if (msg.t === 'move') void this.enter(msg.room, 'join-or-host', 8)
      else if (msg.t === 'bye') this.hostLost(conn, code)
    })
    conn.on('close', () => this.hostLost(conn, code))
    this.keepAlive(peer)
  }

  /** The host vanished: re-run join-or-host, so one of us takes over. */
  private hostLost(conn: DataConnection, code: string) {
    if (this.host !== conn) return // already handled, or we left on purpose
    this.host = null
    this.lastSeen.delete(conn)
    conn.close()
    this.set({ status: 'connecting' })
    const token = this.token
    // Stagger so guests don't all try to take over at the same instant.
    setTimeout(() => {
      if (token === this.token) void this.enter(code, 'join-or-host', 1, TAKEOVER_TIMEOUT_MS)
    }, Math.random() * 800)
  }

  private dropGuest(conn: DataConnection) {
    this.guests = this.guests.filter((g) => g !== conn)
    this.lastSeen.delete(conn)
    conn.close()
    this.set({ people: this.guests.length + 1 })
  }

  private beat() {
    const now = Date.now()
    const silent = (c: DataConnection) => now - (this.lastSeen.get(c) ?? now) > SILENT_MS
    if (this.host) {
      if (silent(this.host)) this.hostLost(this.host, this.snap.seed)
      else this.send(this.host, { t: 'ping' })
    }
    for (const g of [...this.guests]) {
      if (silent(g)) this.dropGuest(g)
      else this.send(g, { t: 'ping' })
    }
  }

  private onHostData(from: DataConnection, msg: Msg) {
    if (msg.t === 'bye') return this.dropGuest(from)
    if (msg.t !== 'swipe') return
    const { pos } = this.snap
    const next = msg.dir === 'next' ? pos + 1 : pos - 1
    if (msg.at === pos && next >= 0 && next <= this.deckSize) {
      this.set({ pos: next })
      this.broadcast()
    } else {
      // Too late: someone else swiped first. Put them back in sync.
      this.send(from, { t: 'state', seed: this.snap.seed, pos })
    }
  }

  /** If we lose the matchmaker, our direct connections survive; just re-register. */
  private keepAlive(peer: Peer) {
    peer.on('disconnected', () => {
      if (this.peer === peer && !peer.destroyed) peer.reconnect()
    })
  }

  private goOffline(old: { peer: Peer | null; host: DataConnection | null; guests: DataConnection[] }, code: string) {
    this.handOff(old, code)
    this.set({ role: 'host', status: 'offline', people: 1 })
  }

  private teardown() {
    this.lastSeen.clear()
    this.host?.close()
    this.guests.forEach((g) => g.close())
    this.peer?.destroy()
    this.peer = null
    this.host = null
    this.guests = []
  }

  private broadcast() {
    const msg: Msg = { t: 'state', seed: this.snap.seed, pos: this.snap.pos }
    this.guests.forEach((g) => this.send(g, msg))
  }

  private send(conn: DataConnection, msg: Msg) {
    if (conn.open) void conn.send(msg)
  }

  /** Guests keep ?room= so a refresh rejoins; hosts don't, so a refresh rolls fresh. */
  private setUrl(code: string | null) {
    const url = new URL(window.location.href)
    if (code) url.searchParams.set('room', code)
    else url.searchParams.delete('room')
    url.searchParams.delete('seed')
    window.history.replaceState(null, '', url)
  }
}

export function useRoom(deckSize: number) {
  const [room] = useState(() => new Room(deckSize))
  useEffect(() => {
    room.start()
    // Hang up cleanly when the tab closes so others notice right away.
    const bye = () => room.stop()
    const back = (e: PageTransitionEvent) => e.persisted && room.start()
    window.addEventListener('pagehide', bye)
    window.addEventListener('pageshow', back)
    return () => {
      window.removeEventListener('pagehide', bye)
      window.removeEventListener('pageshow', back)
      room.stop()
    }
  }, [room])
  const snap = useSyncExternalStore(room.subscribe, () => room.snap)
  return { room, snap }
}
