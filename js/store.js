/* Everything this page keeps between visits, and the only module that touches
   localStorage.

   The line it draws is between what was fetched and what was chosen. Card
   records, printings and set symbols are answers Scryfall gave us: they can be
   thrown away and asked for again, so they expire and Clear cache wipes them.
   The lists and cubes below them are someone's own work, and nothing here
   deletes those.

   Cube lists are conspicuously absent. A cube changes, and seeing that it has
   changed is the point of fetching one, so a list is always pulled fresh. */

/* ---- the caches, wiped by clear() ---- */
const CARD = 'cp:card:', PRINT = 'cp:pr:', SYM = 'cp:sym:';

/* ---- what you chose, which clear() leaves alone ---- */
export const LIST = 'cp:list', TYPED = 'cp:typed', CUBES = 'cp:cubes',
  SEEN = 'cp:seen', MODE = 'cp:mode';

/* A card's printings can gain one, and a name can start matching a card that
   was not out last week. Neither moves fast enough to be worth a shorter
   window; a week is short enough that nobody is looking at stale prices. */
const WEEK = 7 * 24 * 60 * 60 * 1000;

/* Bumped when a cached shape changes, so old entries read as misses rather
   than as the wrong thing. */
const V = 1;

/* Storage is disabled outright in some privacy modes, where even reading
   throws. That is a page with no memory rather than a broken one, so every
   access here answers with a miss instead. */
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const drop = key => { try { localStorage.removeItem(key); } catch {} };

export const get = key => read(key);

export const save = (key, value) => {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
};

/* Backwards, so that dropping keys while reading cannot make the iteration
   skip one. */
function* entries(){
  let n = 0;
  try { n = localStorage.length; } catch { return; }
  for (let i = n - 1; i >= 0; i--){
    let key = null, value = null;
    try { key = localStorage.key(i); value = key === null ? null : localStorage.getItem(key); }
    catch { continue; }
    if (key !== null && value !== null) yield [key, value];
  }
}

const cacheKey = key =>
  key.startsWith(CARD) || key.startsWith(PRINT) || key.startsWith(SYM);

/* Browsers charge two bytes a character for what they store, and the key
   counts as well as the value. */
const cost = (key, value) => (key.length + value.length) * 2;

/* ---- reading and writing a cached entry ---- */

function fresh(key, ttl){
  const raw = read(key);
  if (raw === null) return null;
  let box;
  try { box = JSON.parse(raw); } catch { drop(key); return null; }
  if (!box || box.v !== V || Date.now() - box.t > ttl){ drop(key); return null; }
  return box;
}

/* A few megabytes is several cubes' worth but not an unlimited number of them,
   so a heavy user eventually fills it. A write that overflows takes a quarter
   of the cached bytes off the oldest entries and tries once more; if that still
   fails, the entry simply is not kept, which costs one request later and
   nothing now. Set symbols are exempt — they are permanent, tiny, and the only
   thing here that can never be out of date. */
function stow(key, line){
  if (save(key, line)) return;
  evict();
  save(key, line);
}

const keep = (key, body) => stow(key, JSON.stringify({v: V, t: Date.now(), ...body}));

function evict(){
  const rows = [];
  let bytes = 0;
  for (const [key, value] of entries()){
    if (!key.startsWith(CARD) && !key.startsWith(PRINT)) continue;
    let t = 0;
    try { t = JSON.parse(value).t || 0; } catch {}
    const size = cost(key, value);
    bytes += size;
    rows.push({key, size, t});
  }
  rows.sort((a, b) => a.t - b.t);
  let freed = 0;
  for (const row of rows){
    if (freed >= bytes / 4) break;
    drop(row.key);
    freed += row.size;
  }
}

/* ---- resolved names ---- */

/* Only the fields anything downstream reads: identity(), group(), plan() and
   compare() between them want these and nothing else, and a full Scryfall
   record is a dozen times the size.

   Keyed by the name that was typed rather than by the card, so a line that only
   matched through the slow fuzzy pass — "Drix Interception" — is a hit next
   time and never reaches that pass at all. `alt` is what says so. */
const trim = card => ({
  id: card.id, oracle_id: card.oracle_id, name: card.name,
  printed_name: card.printed_name, type_line: card.type_line,
  mana_cost: card.mana_cost, color_identity: card.color_identity,
  card_faces: (card.card_faces || [])
    .map(f => ({name: f.name, mana_cost: f.mana_cost, oracle_id: f.oracle_id})),
});

export const cards = {
  get(name){
    const box = fresh(CARD + name.toLowerCase(), WEEK);
    return box ? {card: box.c, alt: !!box.a} : null;
  },
  /* A name that matched nothing is not kept. There are very few of them, they
     cost one request each, and remembering a miss for a week would hide a card
     that has since been printed. */
  put(name, card, alt){
    keep(CARD + name.toLowerCase(), alt ? {c: trim(card), a: 1} : {c: trim(card)});
  },
};

/* ---- printings ---- */

/* One entry a card, holding its printings, its art count and the image urls
   those printings need. The urls travel with them because a printing belongs to
   exactly one card, so the fragments partition cleanly and a card can be
   restored on its own. */
export const prints = {
  get(id){
    const box = fresh(PRINT + id, WEEK);
    return box ? {prints: box.p, arts: box.a, src: box.s} : null;
  },
  put(id, {prints, arts, src}){ keep(PRINT + id, {p: prints, a: arts, s: src}); },
};

/* ---- set symbols ---- */

/* Symbols never change, so they carry no timestamp and never expire — but they
   are still something we fetched rather than something you wrote, so clear()
   takes them. Stored as bare markup: a JSON wrapper would do nothing here but
   escape every attribute quote in an SVG. */
export const symbols = {
  get: code => read(SYM + code),
  put: (code, svg) => stow(SYM + code, svg),
};

/* ---- the cache as a whole ---- */

/* What it is costing, for the line the Clear cache control shows on hover.
   Counted rather than parsed: this runs on every hover, and the sizes are the
   interesting part. */
export function size(){
  const out = {bytes: 0, names: 0, prints: 0, symbols: 0};
  for (const [key, value] of entries()){
    const kind = key.startsWith(CARD) ? 'names'
      : key.startsWith(PRINT) ? 'prints'
      : key.startsWith(SYM) ? 'symbols' : null;
    if (!kind) continue;
    out[kind]++;
    out.bytes += cost(key, value);
  }
  return out;
}

export function clear(){
  for (const [key] of [...entries()]) if (cacheKey(key)) drop(key);
}

/* ---- cubes that have been looked up ---- */

/* Twelve is as many as can sit under a field without becoming a list to read
   in its own right. */
const SEEN_MAX = 12;

export function seen(){
  try {
    const list = JSON.parse(read(SEEN) || '[]');
    return Array.isArray(list) ? list.filter(c => c && c.id) : [];
  } catch { return []; }
}

/* Newest first and one entry an id, so fetching a cube again moves it to the
   front rather than doubling it. */
export function sawCube({id, title}){
  const list = [{id, title: title || id}, ...seen().filter(c => c.id !== id)]
    .slice(0, SEEN_MAX);
  save(SEEN, JSON.stringify(list));
  return list;
}
