# Ask Me Anything

A little deck of date-night conversation cards. Swipe a card away to toss it on
the discard pile and draw the next one. The answer isn't the point; the good
stuff is wherever the conversation wanders next.

## The cards

All card content lives in [`cards.yaml`](./cards.yaml), one card per entry:

```yaml
- vibe: nerdy            # whimsical | deep | nerdy | spicy | preference
  fact: Wombats poop cubes.   # optional fun fact / trivia
  question: What's your weirdly specific way of marking your territory?
  nudge: Which of mine have you noticed?   # optional follow-up

- vibe: preference
  question: How do you feel about pineapple on pizza?
  scale: ["crime", "delicacy"]   # optional: two ends of a slider on the card
  nudge: What's a food opinion you'd defend in court?
```

The YAML is turned into JSON at build time, so a typo in it fails the build
instead of breaking the site.

## Seed words

Random seeds are `<adjective>-<animal>`, picked from the lists in
[`words.yaml`](./words.yaml). Add or remove words freely.

## Playing together

The seed is also the room code. Every visit starts a fresh room with a random
seed like `spontaneous-squirrel`. Tap **share** to get a link or QR code, and
anyone who opens it joins your room: swipes show up on everyone's screen.

- **No backend.** Phones connect directly to each other with WebRTC
  ([PeerJS](https://peerjs.com/)). PeerJS's free public server is only used to
  introduce them.
- **The host is the source of truth.** Every swipe is stamped with the card it
  was made on; if two people swipe at once, the host keeps the first and
  everyone animates to the result.
- **Hidden draws.** The card you swipe in is face up for you and face down
  for everyone else, so you can read it out loud. Once it's discarded it's
  face up for all, and swiping back (undo) brings it back face up for everyone.
- **Typing a code** joins that room if someone's in it, or starts it if not.
- **Rolling a new seed** (🎲) asks first, then moves everyone in the room along
  to the new deck.
- **If the host leaves**, one of the guests quietly takes over.
- **Refreshing** as a host starts a new room; guests rejoin theirs.
- If the matchmaker can't be reached, the app still works solo.

Swipe right for the next card, left to undo (put the card back on the deck and
bring back the last one). Arrow keys work too.

To test rooms against a local matchmaker instead of the public one, run
`npx peer --port 9000` and start the app with `VITE_PEER_HOST=127.0.0.1`.

## Develop locally

```sh
npm install
npm run dev
```

Check the production build with `npm run build`.

## Publish with GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the site and publishes it
when changes are pushed to `main`. In the repository settings, open **Pages**
and set **Build and deployment** to **GitHub Actions**. The site will then be
available at `https://rowland-208.github.io/ask-me-anything/`.
