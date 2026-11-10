# Ask Me Anything

A static React + TypeScript site built with Vite and published on GitHub Pages.

## Develop locally

```sh
npm install
npm run dev
```

Edit `src/App.tsx` to build out the site. Check the production build with:

```sh
npm run build
```

## Publish with GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the site and publishes it
when changes are pushed to `main`. In the repository settings, open **Pages**
and set **Build and deployment** to **GitHub Actions**. The site will then be
available at `https://rowland-208.github.io/ask-me-anything/`.
