# AGENTS.md

Notes for anyone (human or agent) changing this app. They come from building it,
and most of them are things we got wrong once.

## What this is

A static, swipeable deck of date-night conversation cards. React 19 + TypeScript
+ Vite, published to GitHub Pages at `https://rowland-208.github.io/ask-me-anything/`.
There is no backend: multiplayer rooms are peer-to-peer over WebRTC.

| File | What's in it |
|---|---|
| `cards.yaml` | All card content (1,200 cards). Human-readable on purpose. |
| `words.yaml` | Adjective and animal lists for random seeds, already vetted. |
| `src/deck.ts` | Card loading, vibes, decks, seeded shuffle, random seeds. |
| `src/App.tsx` | Both screens, the swipe/animation state machine, the piles. |
| `src/room.ts` | Peer-to-peer rooms: hosting, joining, syncing, takeover. |
| `src/Share.tsx` | The share popup (link + QR code, lazy-loaded). |
| `src/index.css` | All styling. Color tokens on `:root`. |
| `vite.config.ts` | A tiny plugin that turns `*.yaml` imports into JSON at build time. |

Commands: `npm run dev`, `npm run build` (runs `tsc -b`, so it type-checks),
`npm run lint` (oxlint). The deploy workflow builds and publishes on every push
to `main`. One lint warning (`set-state-in-effect`) is known and accepted.

## Architecture

### Content

- **YAML is parsed at build time**, not in the browser (smaller bundle, and a
  YAML mistake fails the build instead of shipping a broken site). Import with
  `import data from '../cards.yaml'`; the types are in `src/yaml.d.ts`.
- **YAML pitfall:** an unquoted line containing `: ` breaks parsing. This
  happened with a real card. Use `>-` blocks or double-quoted strings. The
  generated sections of `cards.yaml` use JSON-style double quotes throughout.
- **Card schema:** `vibe` (whimsical, nerdy, deep, preference, spicy),
  `question` (required), optional `fact`, `nudge`, and `scale: [low, high]`
  (drawn as a slider). `loadCards()` validates every field defensively.
- **Vibes and decks.** A "deck" is the set of vibes switched on, encoded as
  letters in a fixed order (`w n d p s`), e.g. `wndp` = everything but spicy.
  `deckId()`/`deckVibes()`/`toDeck()` convert. Deck ids go into room ids and
  share links, so they must stay stable. `toDeck()` sanitizes URL input.
- **Shuffling** is deterministic from the seed string (cyrb53 hash into
  mulberry32, Fisher-Yates). `dealOrder(seed, deck)` filters the card pool by
  deck *first*, then shuffles, so a seed's order depends on the deck. Adding or
  removing cards changes every seed's order; that's acceptable.
- **Random seeds** are `<adjective>-<animal>` from `words.yaml` (lowercase a-z
  only; anything else is skipped). The lists started as the
  `unique-names-generator` lists minus ~175 words that make a bad room name
  (insults, sad, political, religious, identity words). The user preferred
  owning a YAML file plus a few lines of code over a trivial dependency.

### Screens and display state (`App.tsx`)

- Two screens: **deck selection** (`select`) and **game** (`play`). The game
  stays mounted while selection is shown (hidden with `display: none`), so
  room syncing and animations are never torn down. Anything measured while
  hidden reads 0; the ResizeObserver ignores 0 widths.
- **The room snapshot is the truth; the screen catches up.** `snap` (from the
  room) holds `{ seed, deck, pos, drawer }`. Local `seed`/`deck`/`pos` are what
  is currently drawn. A reconciler effect, which only runs when `phase` is
  `idle`, animates one step at a time: `pos + 1` → toss, `pos - 1` → undo,
  anything bigger or a seed/deck change → redeal. Local swipes animate
  immediately *and* call `room.act()`; the reconciler fixes any disagreement.
- **Phases:** `idle | drag | busy`. Input (pointer and keyboard) is ignored
  while `busy`. Tests that press keys during an animation will see presses
  dropped; that is intended behavior, not a bug.
- **Animation rig:** `.fly-x` (X translate) > `.fly-y` (Y translate, rotate,
  scale) > `.flip` (rotateY) > two faces. X and Y get different easing curves,
  which makes cards travel in arcs. Motion classes (`m-toss`, `m-draw`, …)
  pick the curves. To start a transition from a new position, set the pose
  with `motion: 'none'`, then set the target inside a double
  `requestAnimationFrame`.
- **Piles render real full-size cards scaled down** (`PILE_W / cardW`), so a
  tossed card lands on the discard pile pixel-for-pixel. Targets are measured
  with `getBoundingClientRect` at animation time.
- **Card text scales with the card** via `cqw` units. `container-type` must be
  on a *wrapper* (`.fly-y`, `.pile-card`, `.mini-card`), not on `.face`
  itself: an element's own padding/gap in `cqw` resolves against its
  *ancestor* container, which broke the desktop layout once.
- **Hidden draws:** whoever swipes a new card is its `drawer`; only they see
  the face, everyone else sees the back. Discarded cards are face up for all,
  and undo brings a card back face up. If the drawer leaves, the host reveals it.

### Rooms (`room.ts`)

- **Room id = `ask-me-anything-v1-` + deck + `-` + seed.** The same seed with
  the same deck is the same room; anything else is a different room. Share
  links carry `?room=<seed>&deck=<letters>` and skip the selection screen.
- **You're only in a room while playing.** Deck selection is outside any room;
  "deal me in" calls `join()`, and the logo calls `leave()`.
- **Host-authoritative.** The host's browser owns `{ seed, deck, pos, drawer }`
  and broadcasts it. Guests send swipes stamped with the card they swiped on
  (`at`); the host drops stale ones and re-sends its state to the loser.
  Simultaneous swipes therefore converge without any locking.
- **Joining claims the room first** (`openPeer(roomId)`), and only connects as
  a guest if the id is taken (`unavailable-id`). Asking to join an empty room
  first made every new game wait ~5 s for the matchmaker to time out.
- **Guests say `hello`, and the host replies with full state.** The host's
  on-connect state message can arrive before the guest has attached its data
  handler, so it can be lost. Never rely on the first message.
- **Heartbeat + bye.** Everyone pings every 2 s; 7 s of silence means gone.
  Clean exits send `bye` so others react immediately. WebRTC alone can take a
  very long time to notice a closed tab.
- **Takeover:** when the host vanishes, guests re-run join-or-host after a
  random 0–800 ms stagger; one claims the id and the rest join it.
- **Moving rooms** (the out-of-cards "new seed" button): the host registers the
  new id *first*, then sends `move`, then hangs up the old room 400 ms later.
- **Ordering bugs we hit twice:** closing a connection can fire its `close`
  handler synchronously. If `this.host` still points at that connection, it
  looks like the host vanished and triggers a takeover/rejoin. Always null out
  `peer`/`host`/`guests` *before* closing (see `teardown()` and `enter()`).
  Related: a guest must let go of its old host as soon as it starts entering a
  new room, or the old room hanging up mid-move cancels the move.
- **Token pattern:** every `enter()` bumps `this.token`; async work checks
  `stale()` and bails. Delayed callbacks capture the token too.
- **Refresh behavior:** hosts keep a clean URL, so a refresh starts fresh
  (new seed, selection screen). Guests keep `?room=&deck=`, so a refresh rejoins.
- **Offline fallback:** if the matchmaker is unreachable, status goes
  `offline` and the app still works solo.
- PeerJS and the QR library are dynamically imported so first paint stays fast.

### Styling

- Cartoony and simple: Fredoka font, 3px dark outlines, solid drop shadows,
  pastel vibe colors (`--whimsical`, `--nerdy`, …, each with an `-ink` shade).
- **Reduced motion:** the global rule shortens animations *and* sets
  `animation-iteration-count: 1`. Shortening an infinite animation to 1 ms
  without that makes it loop every millisecond, which looks like violent
  shaking. The user hit this on Android with "remove animations" on.
- Layout must work on a 320×568 phone (Playwright's `iPhone SE`) with no page
  scroll. Card width is `min(84vw, 345px, calc((100dvh - 290px) / 1.4))`.

## Testing

The sandbox has Chromium and Playwright preinstalled (`require('playwright')`).
Write throwaway scripts in the scratchpad, not the repo.

- **The public PeerJS server is blocked in the sandbox.** Run a local one and
  build a test copy pointed at it:
  ```js
  // srv.cjs (after `npm install peer` in a scratch dir)
  const { PeerServer } = require('peer')
  PeerServer({ port: 9000, path: '/', host: '127.0.0.1' })
  ```
  Bind to `127.0.0.1` explicitly; the default IPv6 bind fails here. Then:
  `VITE_PEER_HOST=127.0.0.1 npx vite build --outDir <scratch>/testdist` and
  `npx vite preview --outDir <scratch>/testdist --port 4174`.
  Launch Chromium with `--disable-features=WebRtcHideLocalIpsWithMdns` so two
  browser contexts can connect over loopback.
- **Multiplayer tests:** open one browser *context* per player and script
  scenarios (join by link, swipes both ways, simultaneous swipes, late joiner,
  leave/rejoin, host vanishes via `context.close()`, host leaves cleanly,
  same seed with a different deck). Read state from the DOM: pile labels, the
  share button's `status-*` and `host`/`guest` classes, `location.search`.
- **Timing bugs hide locally.** Joining is near-instant on loopback, so races
  that only appear on real networks pass. Reproduce them by temporarily
  shrinking a delay (e.g. the 400 ms hand-off to 0) in a test build; prove the
  failure first, then the fix.
- **Card overflow:** don't swipe through 1,200 cards (slow, and dropped key
  presses silently shrink coverage). Instead render every card from
  `cards.yaml` into the game's `.flip` with the same markup as `CardFront` and
  check `scrollHeight > clientHeight`, on `iPhone SE` and `Pixel 7`. Pick a
  deck first; the game is hidden on the selection screen.
- **Check that your test can fail.** Feed the overflow check a deliberately
  oversized card; confirm a "visited N cards" count actually reached N.
- **Content checks** after editing cards: parse `cards.yaml`, count per vibe,
  look for exact duplicates, and for near-duplicates compare meaningful words
  (word-overlap), not raw characters, which mostly flags shared sentence frames.
- Look at screenshots for anything visual; numbers alone missed real problems
  (a hidden deck pile, a cut-off room code, a misplaced sticker).

## Card content guidelines

- The answer isn't the point; every card should lead somewhere. Each has a
  `nudge` follow-up that turns the answer into a story, a plan, or a question
  about the two of you.
- **Balance:** 1,000 cards at 30% whimsical, 30% nerdy, 20% deep, 20% spicy,
  plus 200 preference (100 scales, 100 favorites). Keep the mix when adding
  cards, and ask before letting one type dominate.
- **Nerdy cards always lead with a fact, and facts must be true.** Only use
  facts you are confident in; hedge single studies ("one study found…",
  "legend says…"). Several plausible-sounding facts were rejected or reworded.
- **Spicy** ranges from flirty to kinky but stays playful, consensual, and
  about the couple; avoid past partners. Spicy is off by default, and any
  spicy card shown outside a game (like the sample on the selection screen)
  should be mild.
- Avoid near-duplicates of existing cards; check after every batch.

## Working with this user

- **Commit and push straight to `main`** (and keep the dev branch in sync). No
  pull requests. Check `main` hasn't diverged before pushing.
- Wants the UI **simple, cute, and cartoony**: no extra buttons, minimal
  chrome, emoji over labels where it saves space. Proportions matter: the main
  card shouldn't dwarf the other UI.
- **Generating a new seed always asks for confirmation.** Spicy defaults off.
- For big or ambiguous requests (large content batches, design changes like
  rooms), they like to discuss the design first, and asked for the request to
  be restated before a big job. Do that before generating hundreds of cards.
- Prefers simple architectures that are "good enough" over robust-but-complex
  ones, and building trivial things from scratch over adding a library.
- Tests on an Android phone with reduced animations turned on; check reduced
  motion and real-network behavior, not just desktop loopback.
- Report honestly: say what was verified, what wasn't (e.g. the public PeerJS
  server is untested from the sandbox), and what a fix changes for them.
