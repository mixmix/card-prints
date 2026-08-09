# Card Print Gallery

A static gallery of every English paper printing of a set of Magic cards, grouped by colour.
Card data and images come from the [Scryfall](https://scryfall.com) API.

## Layout

```
index.html        markup and control elements only
styles.css        all styling (light/dark via CSS custom properties)
js/data.js        data source — fetches and normalises the JSON
js/render.js      pure HTML generation, no DOM access
js/ui.js          DOM wiring: controls, state, rendering
js/main.js        entry point
data/cards.json   cards, printings, stats
data/images.json  card id → image URL (or inlined base64 webp)
```

## Running locally

The page fetches its JSON, so it needs to be served over HTTP — opening
`index.html` from disk will not work.

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Hosting on GitHub Pages

Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
No build step is involved; `.nojekyll` keeps Pages from running the files through Jekyll.
