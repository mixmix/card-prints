# Card Print Gallery

Paste a list of Magic cards — or point at a [CubeCobra](https://cubecobra.com)
cube, or compare two of them — and see every English paper printing of each
card, grouped by colour. Card data and images come from the
[Scryfall](https://scryfall.com) API, fetched in the browser — there is no
build step and no server of our own.

There are three ways in, chosen at the top of the page:

| | |
|---|---|
| **Text list** | paste card names |
| **CubeCobra → View** | pull one cube's list |
| **CubeCobra → Diff** | compare two cubes and pick a slice to look at |

## A typed list

Paste one card a line and press **Load**. Quantities and set hints are ignored,
so a decklist pastes in as it is:

```
4x Thraben Inspector
Lightning Bolt (2x2) 117
Wear // Tear
```

Only the name lookup is worth waiting for — it is what decides whether the list
is right, and it is quick. It runs in two phases, each with its own tally:

```
✓  Finding cards               20 of 22 matched
·  Checking alternate names    2 of 3 names
```

Each phase stays on screen once it has run and swaps its count for what it came
back with. A phase with no work to do — nothing to recover on a list that was
spelt correctly — is not shown at all.

Names that needed a second look are then listed with a tick or a cross:

- **✗** nothing matched — check the spelling.
- **✓ against a different name** the card was found under an alternate name.
  Some printings carry a different name on the physical card, so
  *Drix Interception* is a printing of *Amazing Acrobatics*.

**Taking up a suggestion settles it there and then.** The card behind it is
already in hand — the fuzzy lookup that found it is what produced the
suggestion — so accepting rewrites the line, moves that card onto the name now
on it, and turns the row into a tick. The count above goes up as you go. Nothing
is looked up again and there is no reason to run the list a second time.

If every name matched exactly the gallery opens straight away; otherwise
**Continue** carries on with what was found. **Edit list** goes back.

The list is kept in `localStorage`, so it survives a reload.

## Printings arrive while you browse

The gallery opens as soon as the names resolve — for a 474-card cube, about
three seconds — with every row named and grouped, each holding a few blank
tiles where its printings will go. Those are fetched afterwards, fifteen cards
at a time, and each row is redrawn on its own as they land, so nothing under
the reader moves. The masthead counts them off:

```
474 cards · 812 printings · 331 distinct arts    loading printings · 120 of 474
```

**Whatever is on screen is fetched next.** Before each batch goes out, the rows
still waiting are ranked by distance from the middle of the viewport, so
scrolling to the bottom of a 474-card cube gets you that part of it rather than
making you wait for the other 400. The ranking is worked out fresh each time
rather than tracked as the page moves — one pass over the waiting rows costs
nothing beside the request it precedes, and it can never be stale. Cards
filtered out of view by a search are still fetched, just last.

A card that resolves but has no English paper printing — digital-only cards,
which cubes do contain — says so in place of its tiles, and is named under the
gallery, rather than quietly going missing.

## Cubes

**View** takes a cube and drops its list into the same textarea, so everything
above still applies — the names stay editable and it is the textarea, not the
cube, that gets loaded. Any of these work:

```
https://cubecobra.com/cube/list/peach_peasant
peach_peasant
https://cubecobra.com/cube/list/5d3f7245d1bbf667dd9d4286
```

so do the other cube sub-pages (`/cube/overview/…`, `/cube/playtest/…`), with
or without a scheme, trailing slash or query string. Fetching replaces what was
in the box and offers an **Undo**.

**Diff** takes two cubes. Resolve each one — they get their own progress and
their own tick/cross report, so a name can be fixed and that cube resolved
again on its own.

**A side is finished when its list is final**, and the chooser waits for both
of them. A slot that comes back clean settles itself and folds away to a
one-line summary; one with something outstanding stays open, marked, until
every suggestion has been taken up or **Use these anyway** accepts what is
left. Comparing half-finished lists would put counts on screen that are about
to change, so it doesn't.

Once both are settled:

```
WHAT DO YOU WANT TO SEE?
457 shared · 17 only in A · 83 only in B

( ) ◕◔  In both cubes                                    457
        peach peasant cube ∩ The Peasant Cube 2026
        ▸ Preview 457 cards
( ) ◑◯  Only in peach peasant cube                        17
        missing from The Peasant Cube 2026
( ) ◯◐  Only in The Peasant Cube 2026                     83
        missing from peach peasant cube
```

Each option carries a two-circle Venn with the slice it would show filled in —
A on the left, B on the right, the same way round every time. It says what the
label says and says it faster, which is also why it is marked decorative and
never announced.

Each preview opens in place into its own scrolling box, so a 457-card list
neither moves the page nor runs off the end of it. Choosing a slice and
pressing **Show these cards** goes straight to the gallery — the cards are
already resolved, so there is nothing at all left to wait for.

Cubes are compared by **card identity, not by the name each list used**. Two
cubes can write the same card differently — `Wear` against `Wear // Tear`, or
an alternate printed name — and comparing strings would call that a difference.
Where it happens, the summary says how many shared cards are listed under
different names.

### Sharing a comparison

The address bar always holds the cubes on screen:

```
index.html?a=peach_peasant&b=5d3f7245d1bbf667dd9d4286
```

Opening that link goes straight to Diff, pulls both cubes and resolves them
without being asked — someone followed it to see the comparison, so it runs
itself. Each side is still resolved on its own, in turn, so a name that needs
attention stops at the cube it belongs to and the chooser waits as usual.
**Copy link** puts the URL on the clipboard.

A single cube shares as `?cube=peach_peasant`. That one only pulls the list,
since loading it leaves the setup screen for the gallery entirely — a bigger
jump to make on someone's behalf than filling in a comparison they can look at.

## Layout

```
index.html        markup, control elements, and the CSP
styles.css        all styling
js/scryfall.js    Scryfall client — rate limiting, 429s, the batch endpoints
js/cubecobra.js   CubeCobra client — id parsing, cube list, cube name
js/progress.js    weighted progress across whichever phases a run uses
js/data.js        names in, gallery data out: resolve, plan, fetch, compare
js/render.js      pure HTML generation, no DOM access
js/ui.js          DOM wiring: screens, controls, state, rendering
js/main.js        entry point
```

Screens are swapped by CSS alone: every element names the screens it belongs to
with `data-pane`, and the current `data-view` on `<body>` hides everything that
is not it. Adding a screen is one more rule rather than one more thing every
existing rule has to remember to hide.

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

Resolving both cubes above — 1,014 names — costs 20 API requests and no 429s.

## Talking to CubeCobra

`/cube/api/cubelist/<id>` answers with `Access-Control-Allow-Origin: *`, so the
browser can call it directly. It returns one card name a line, about 8 KB for a
500-card cube. The obvious alternative, `/cube/api/cubeJSON/<id>`, is **1.26 MB**
for the same cube — it embeds a full denormalised card record each, around 2.6 KB
apiece, of which the names we want are 0.6%.

Two things to know if you touch this:

- **A 404 carries no CORS header.** The browser rejects `fetch` with a bare
  `TypeError` before any status can be read, so a wrong id, an unreachable site
  and a `connect-src` violation are genuinely indistinguishable from script.
  The message says so rather than guessing, and the raw error goes to the
  console where the browser's own explanation will be sitting next to it.
- **The cube's display name is only in `cubeJSON`,** which ignores `Range`
  (it answers `200` with the whole body). But `cards` is its last key and
  everything before it is about 2 KB, so `title()` reads the stream until the
  cards begin, closes the prefix into valid JSON, and cancels. That costs tens
  of kilobytes rather than the full 224 KB gzipped. It can never throw: a null
  just means the cube is labelled with its id.

## CORS and CSP

[Scryfall's guidance](https://scryfall.com/docs/api/http-concerns): `api.scryfall.com`
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
