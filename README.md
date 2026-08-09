# Card Print Gallery

Paste a list of Magic cards and see every English paper printing of each one,
grouped by colour. Card data and images come from the
[Scryfall](https://scryfall.com) API, fetched in the browser — there is no
build step and no server of our own.

## Using it

Open the page, paste one card a line, and press **Load**. Quantities and set
hints are ignored, so a decklist pastes in as it is:

```
4x Thraben Inspector
Lightning Bolt (2x2) 117
Wear // Tear
```

A progress bar runs while the names are resolved and the printings fetched.
Names that needed a second look are listed with a tick or a cross:

- **✗** nothing matched — check the spelling.
- **✓ against a different name** the card was found under an alternate name.
  Some printings carry a different name on the physical card, so
  *Drix Interception* is a printing of *Amazing Acrobatics*. The suggestion
  comes with a button that rewrites that line in your list.

If every name matched exactly the gallery opens straight away; otherwise
**Continue** carries on with what was found. **Edit list** goes back.

The list is kept in `localStorage`, so it survives a reload.

## Layout

```
index.html        markup, control elements, and the CSP
styles.css        all styling
js/scryfall.js    Scryfall client — rate limiting, 429s, the batch endpoints
js/data.js        names in, gallery data out: resolve, fetch, group, index
js/render.js      pure HTML generation, no DOM access
js/ui.js          DOM wiring: views, controls, state, rendering
js/main.js        entry point
```

## Talking to Scryfall

The [rate limits](https://scryfall.com/docs/api/rate-limits) are 2 requests a
second for the card endpoints and 10 for everything else, and ignoring a 429
gets an application banned rather than warned. `js/scryfall.js` threads every
call through one promise chain holding a minimum gap, and a 429 backs off for
the documented 30 seconds and widens that gap for the rest of the session.

Staying under the limit is mostly a matter of asking for more at a time. Names
are resolved 75 at a time through
[`/cards/collection`](https://scryfall.com/docs/api/cards/collection), and
printings are fetched 15 cards at a time through `/cards/search`, matching on
`oracleid:` rather than on name so that `!"Lightning Bolt"` cannot drag in
"Emeritus of Conflict // Lightning Bolt". A forty-card list costs about eleven
API requests in total.

Three quirks are worth knowing:

- `/cards/collection` matches either half of a split card but not the joined
  `Wear // Tear` form the card is actually filed under, so a miss with a slash
  in it is retried with just the first face.
- It does not match alternate printed names at all, so anything still missing
  gets one `/cards/named?fuzzy=` lookup each — that is what resolves
  *Drix Interception*. Those are one at a time and rate limited, so they are
  the slow path, and by then there should be very few left.
- Set symbols come from `svgs.scryfall.io`, which is not rate limited. They are
  fetched in parallel, stripped down to bare geometry — a referenced SVG is an
  opaque image, so CSS could not colour its paths by rarity — and cached in
  `localStorage`, since they never change.

[CORS and CSP](https://scryfall.com/docs/api/http-concerns): `api.scryfall.com`
and the `*.scryfall.io` asset origins send `Access-Control-Allow-Origin: *`,
and the preflight for the JSON POST to `/cards/collection` allows
`Content-Type`, so the browser can call them directly and no proxy is needed.
`index.html` carries a matching CSP. Scryfall asks for a `User-Agent`, but
tells on-page JavaScript to leave the browser's own alone — which fetch()
insists on anyway; the `Accept` header it also requires we do send.

## Running locally

The page is served as-is, but it is a module, so it needs HTTP — opening
`index.html` from disk will not work.

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Hosting on GitHub Pages

Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
No build step is involved; `.nojekyll` keeps Pages from running the files through Jekyll.
