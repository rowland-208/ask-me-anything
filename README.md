# Ask Me Anything

A little deck of date-night conversation cards. Swipe a card away to toss it on
the discard pile and draw the next one. The answer isn't the point; the good
stuff is wherever the conversation wanders next.

## The cards

All card content lives in [`cards.yaml`](./cards.yaml), one card per entry:

```yaml
- vibe: nerdy            # whimsical | deep | nerdy | spicy
  fact: Wombats poop cubes.   # optional fun fact / trivia
  question: What's your weirdly specific way of marking your territory?
  nudge: Which of mine have you noticed?   # optional follow-up
```

The YAML is turned into JSON at build time, so a typo in it fails the build
instead of breaking the site.

## Shuffling

The 🎲 box at the top is the shuffle seed. The same seed always gives the same
order, and it's saved in the URL (`?seed=...`) so you can share a deck.
Arrow keys / space also swipe on a laptop.

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
