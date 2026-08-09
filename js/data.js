/* Turns a pasted list of card names into the shape the gallery renders:
   resolve the names, fetch every printing, then group, index and sort them. */

import * as api from './scryfall.js';
import * as store from './store.js';

/* Which card this is, regardless of the name it was listed under. The gallery
   groups rows by it and the cube diff buckets by it; they have to agree, so
   there is one rule and it lives here. */
export const identity = card =>
  card.oracle_id || (card.card_faces || [])[0]?.oracle_id || card.id;

const GROUPS = [['w','White'],['u','Blue'],['b','Black'],['r','Red'],['g','Green'],
  ['m','Multicolour'],['c','Colourless'],['l','Lands']];
const ORDER = new Map(GROUPS.map(([key], i) => [key, i]));
const NAME = new Map(GROUPS);

/* ---- names in ---- */

/* One card a line. A pasted decklist tends to carry a quantity in front and a
   set hint behind, so both are shaved off. `//` is left alone, since split
   cards need it. A leading number only counts as a quantity if it is short —
   the card "1996 World Champion" opens with four digits. */
export function parse(text){
  const seen = new Set(), names = [];
  for (const line of text.split('\n')){
    const name = line
      .replace(/^\s*\d{1,2}\s*x?\s+/i, '')
      .replace(/\s*[([{][a-z0-9]{2,6}[)\]}][\s\d\w-]*$/i, '')
      .trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/* Every string a card could reasonably have been typed as: its own name, each
   face of a double-faced one, and the alternate name some printings carry on
   the physical card. */
const aliases = card =>
  [card.name, card.printed_name, ...(card.card_faces || []).map(f => f.name)]
    .filter(Boolean).map(s => s.toLowerCase());

/* Scryfall returns matches in request order with the misses dropped, so
   position alone would do — but pairing by name is exact rather than merely
   likely, so that goes first and position is only the fallback. */
function pair(names, found){
  const byAlias = new Map();
  for (const card of found)
    for (const alias of aliases(card))
      if (!byAlias.has(alias)) byAlias.set(alias, card);

  const out = new Map();
  names.forEach((name, i) => {
    const card = byAlias.get(name.toLowerCase()) ?? found[i];
    if (card) out.set(name, card);
  });
  return out;
}

async function lookup(names){
  const {found, missed} = await api.collection(names);
  const gone = new Set(missed);
  return {cards: pair(names.filter(n => !gone.has(n)), found), missed};
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/* Resolution runs in three passes, each cheaper per name than the last is
   forgiving, so almost everything is settled by the first bulk request — and
   the pass before all of them costs nothing at all, since a name looked up in
   the last week is already in hand. */
async function resolve(names, step){
  const cards = new Map(), alts = new Set();
  let missed = [];

  /* The cache is read above the batching rather than inside it: a hit that
     still had to travel in a 75-name request would have saved nothing. What is
     left is the only thing worth asking about. */
  const ask = [];
  for (const name of names){
    const hit = store.cards.get(name);
    if (!hit){ ask.push(name); continue; }
    cards.set(name, hit.card);
    if (hit.alt) alts.add(name);
  }
  const known = cards.size;
  step(known);

  /* No batch depends on any other, so they all go at once and the client's
     pacing decides when each actually leaves. Asking one question at a time was
     what made a 500-card cube take a minute: a 75-name lookup takes about 2.6
     seconds to come back and we are allowed one every 550ms, so waiting for
     each answer spent four fifths of the rate we were entitled to. */
  let asked = 0;
  const got = await Promise.all(chunk(ask, api.NAMES_PER_LOOKUP).map(async batch => {
    const answer = await lookup(batch);
    step(known + (asked += batch.length));
    return answer;
  }));
  /* Merged in the order asked rather than the order answered, so a list
     resolves the same way on every run. */
  for (const answer of got){
    for (const [name, card] of answer.cards){
      cards.set(name, card);
      store.cards.put(name, card, false);
    }
    missed.push(...answer.missed);
  }

  /* `/cards/collection` matches either half of a split card but not the joined
     "Wear // Tear" form the card is actually filed under, so a miss with a
     slash in it has earned one more attempt. */
  const splits = missed.filter(n => n.includes('//'));
  /* Ask once per distinct face: two split cards can share a first face, and a
     repeated name in one lookup would let pair()'s positional fallback drift. */
  const faceOf = new Map(splits.map(n => [n, n.split('//')[0].trim()]));
  const faces = [...new Set(faceOf.values())];
  const retried = await Promise.all(
    chunk(faces, api.NAMES_PER_LOOKUP).map(batch => lookup(batch)));
  for (const {cards: got} of retried)
    for (const [name, face] of faceOf){
      const card = got.get(face);
      if (card && !cards.has(name)){
        cards.set(name, card);
        /* Kept under the joined name the list used, which is the string that
           will be asked about next time. */
        store.cards.put(name, card, false);
      }
    }
  if (splits.length) missed = missed.filter(n => !cards.has(n));

  return {cards, missed, alts};
}

/* ---- printings out ---- */

function group(card){
  if (/\bLand\b/.test(card.type_line || '')) return 'l';
  const ci = card.color_identity || [];
  return ci.length > 1 ? 'm' : ci.length ? ci[0].toLowerCase() : 'c';
}

/* The chips under a tile: what makes this printing look unlike the plain one. */
function tags(p){
  const fx = p.frame_effects || [], finishes = p.finishes || [], out = [];
  if (p.border_color === 'borderless') out.push('borderless');
  if (p.border_color === 'gold') out.push('gold border');
  if (p.border_color === 'white') out.push('white border');
  if (p.frame === '1997') out.push('retro');
  if (fx.includes('showcase')) out.push('showcase');
  if (fx.includes('extendedart')) out.push('extended');
  if (fx.includes('inverted')) out.push('inverted');
  if (fx.includes('legendary')) out.push('legendary');
  if (finishes.includes('etched')) out.push('etched');
  if (finishes.length && !finishes.includes('nonfoil')) out.push('foil only');
  if ((p.promo_types || []).includes('serialized')) out.push('serialized');
  if (p.promo) out.push('promo');
  return out;
}

/* A double-faced card carries its image and illustration on the front face
   rather than at the top level. */
const front = p => p.image_uris ? p : (p.card_faces || [])[0] || {};
const artOf = p => p.illustration_id || front(p).illustration_id || p.id;

/* `arts` doubles as the numbering: each new illustration takes the next index,
   and since printings arrive oldest first, art 1 is the original. */
function printing(p, arts, src){
  const art = artOf(p);
  if (!arts.has(art)) arts.set(art, arts.size);
  src[p.id] = front(p).image_uris?.normal || '';
  return {
    i: p.id, s: p.set.toUpperCase(), sn: p.set_name, n: p.collector_number,
    y: (p.released_at || '').slice(0, 4), a: p.artist || '',
    u: (p.scryfall_uri || '').split('?')[0],
    p: p.prices?.usd || p.prices?.usd_foil || p.prices?.usd_etched || '',
    t: tags(p), x: arts.get(art), r: p.rarity,
  };
}

/* Every row the gallery will show, known the moment the names resolve: all of
   this comes off the card itself, so the page can be drawn and browsed while
   the printings are still on their way. `prints` is null until they land. */
export function plan(resolved, alts){
  /* Two spellings of the same card collapse into one row, so group by identity
     rather than by the line that was typed. */
  const byOracle = new Map();
  for (const [input, card] of resolved){
    const id = identity(card);
    if (!byOracle.has(id)) byOracle.set(id, {card, inputs: []});
    byOracle.get(id).inputs.push(input);
  }

  const cards = [];
  for (const [id, {card, inputs}] of byOracle){
    const key = group(card);
    cards.push({
      id, name: card.name,
      type: card.type_line || '',
      mana: card.mana_cost
        || (card.card_faces || []).map(f => f.mana_cost).filter(Boolean).join(' // '),
      b: key, bn: NAME.get(key),
      prints: null, arts: 0,
      /* the name the list used, when it was not the one Scryfall files the
         card under — the gallery prints it under the title */
      alt: inputs.find(n => alts.has(n)) || '',
    });
  }
  cards.sort((a, b) => ORDER.get(a.b) - ORDER.get(b.b) || a.name.localeCompare(b.name));
  return cards;
}

/* The printings of a handful of cards, in the shape the tiles want, with their
   images added to `src`. An empty list back is a real answer: the card exists
   but has no English paper printing, which is how digital-only cards arrive. */
export async function printsFor(ids, src){
  const found = new Map();
  for (const p of await api.printings(ids)){
    if (!found.has(p.oracle_id)) found.set(p.oracle_id, []);
    found.get(p.oracle_id).push(p);
  }
  const out = new Map();
  for (const id of ids){
    const arts = new Map(), mine = {};
    const got = {
      prints: (found.get(id) || []).map(p => printing(p, arts, mine)),
      arts: arts.size,
    };
    /* The images are gathered per card before being merged into the shared map,
       so the cache can keep each card's own alongside its printings. An empty
       list is kept too: "this card has no English paper printing" is a real
       answer and worth not asking for again. */
    Object.assign(src, mine);
    store.prints.put(id, {...got, src: mine});
    out.set(id, got);
  }
  return out;
}

/* What the cache already holds for these cards, in the same shape printsFor()
   returns, with their images added to `src`.

   Read here rather than inside printsFor() because the gallery fetches fifteen
   cards a request: satisfying part of a batch from the cache would leave the
   request behind it asking after one or two. Taking the hits out first instead
   keeps every request that does go out full. */
export function cachedPrints(ids, src){
  const out = new Map();
  for (const id of ids){
    const hit = store.prints.get(id);
    if (!hit) continue;
    Object.assign(src, hit.src);
    out.set(id, {prints: hit.prints, arts: hit.arts});
  }
  return out;
}

/* ---- set symbols ---- */

/* Symbols are fetched from the URL the set record gives us and reduced to bare
   geometry. They have to live in the document rather than behind a url() — a
   referenced SVG is an opaque image, so CSS cannot colour its paths by rarity.
   Anything that could carry its own appearance or behaviour is dropped,
   leaving the stylesheet in sole charge. */
function geometry(text){
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (svg.nodeName === 'parsererror' || !svg.getAttribute('viewBox')) return null;
  for (const el of svg.querySelectorAll('script,style,image,foreignObject,a')) el.remove();
  for (const el of [svg, ...svg.querySelectorAll('*')]){
    for (const {name} of [...el.attributes]){
      /* fill-rule stays — some symbols need it to punch their holes */
      if (name.startsWith('on') || name === 'fill' || name === 'style') el.removeAttribute(name);
    }
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg.outerHTML;
}

/* svgs.scryfall.io is not rate limited, so these run in parallel — but they
   also never change, which makes them worth keeping between visits. A symbol
   that will not load costs its card nothing but an icon. */
async function toSymbols(codes, all, done){
  const sets = {}, queue = [...codes];
  const worker = async () => {
    for (let code; (code = queue.shift()) !== undefined; ){
      const set = all[code];
      if (set){
        const cached = store.symbols.get(code);
        let svg = cached;
        if (!svg) try {
          const res = await fetch(set.icon);
          if (res.ok) svg = geometry(await res.text());
        } catch { /* offline, blocked, or malformed — draw nothing */ }
        if (svg){
          sets[code] = {name: set.name, svg};
          if (!cached) store.symbols.put(code, svg);
        }
      }
      done();
    }
  };
  await Promise.all(Array.from({length: 8}, worker));
  return sets;
}

/* ---- the whole job ---- */

/* Resolving names is the only part worth waiting for: it is what decides
   whether the list is right, and it is quick. Printings and set symbols are
   fetched afterwards, into a gallery that is already on screen and already
   browsable — so they get no phase here. */
export const PHASE = {
  find: {id: 'find', label: 'Checking card names',      unit: 'names', weight: .7},
  alt:  {id: 'alt',  label: 'Checking alternate names', unit: 'names', weight: .3},
};

/* The fuzzy pass is one rate-limited request per unmatched name. On a typed
   list that is nothing; on a 500-card cube pasted wrong it would be a
   half-hour hang with no way out, so it is capped and the rest reported as
   misses. */
const MAX_ALTS = 60;

export async function resolveNames(names, {at, onReport, maxAlts = MAX_ALTS} = {}){
  at('find', 0, names.length);
  /* `alts` comes back already holding the names the cache knows were found
     under another name, since those never reach the pass below a second time. */
  const {cards: resolved, missed, alts} = await resolve(names, done => at('find', done, names.length));
  at('find', names.length, names.length, `${resolved.size} of ${names.length} matched`);

  /* Anything still unmatched gets one fuzzy lookup each — that is what finds a
     card listed under an alternate printed name. A list where every name was
     spelt correctly skips the phase rather than reporting nothing to do, so
     what shows on screen is only work that ran. */
  const tryable = missed.slice(0, maxAlts);
  if (tryable.length){
    at('alt', 0, tryable.length);
    /* Counted here rather than off `alts`, which may already carry names this
       run never had to look up. */
    let found = 0, back = 0;
    /* One request per name, all sent at once and paced by the client — these
       are the slow path, so waiting for each answer before asking the next
       question is exactly where it hurts most. */
    const guesses = await Promise.all(tryable.map(async name => {
      const card = await api.named(name);
      at('alt', ++back, tryable.length);
      return [name, card];
    }));
    for (const [name, card] of guesses){
      if (!card) continue;
      resolved.set(name, card);
      alts.add(name);
      found++;
      store.cards.put(name, card, true);
    }
    const skipped = missed.length - tryable.length;
    at('alt', tryable.length, tryable.length,
      (found ? `${found} found under another name` : 'none recovered')
      + (skipped ? ` · ${skipped} not checked` : ''));
  }

  onReport?.(names.map(name =>
    !resolved.has(name) ? {input: name, status: 'miss'}
    : alts.has(name) ? {input: name, status: 'alt', name: resolved.get(name).name}
    : {input: name, status: 'ok'}));

  return {resolved, alts, missing: names.filter(n => !resolved.has(n))};
}

/* The symbols for whichever sets have turned up so far, added to `into`. A code
   that fails is recorded as null rather than left absent, so a set whose symbol
   will not load is not asked for again on every later batch. */
export async function symbolsFor(codes, into){
  const need = codes.filter(code => !(code in into));
  if (!need.length) return [];
  const all = await api.sets();
  Object.assign(into, await toSymbols(need, all, () => {}));
  for (const code of need) if (!(code in into)) into[code] = null;
  return need;
}

/* ---- comparing two lists ---- */

/* Compared by card identity, never by the line each list used: two cubes can
   write the same card differently — "Wear" against "Wear // Tear", or an
   alternate printed name — and comparing strings would call that a difference.

   Each entry keeps the line both sides actually used, which is what lets the
   preview and the gallery caption stay honest about what was typed. */
export function compare(a, b){
  const index = resolved => {
    const by = new Map();
    for (const [input, card] of resolved){
      const id = identity(card);
      if (!by.has(id)) by.set(id, {id, name: card.name, card, input});
    }
    return by;
  };

  const left = index(a), right = index(b);
  const both = [], onlyA = [], onlyB = [];
  for (const [id, e] of left){
    const other = right.get(id);
    if (other) both.push({id, name: e.name, card: e.card, a: e.input, b: other.input});
    else onlyA.push({id, name: e.name, card: e.card, a: e.input, b: null});
  }
  for (const [id, e] of right)
    if (!left.has(id)) onlyB.push({id, name: e.name, card: e.card, a: null, b: e.input});

  const byName = (x, y) => x.name.localeCompare(y.name);
  for (const list of [both, onlyA, onlyB]) list.sort(byName);

  return {
    both, onlyA, onlyB,
    /* shared cards the two cubes spell differently — the visible payoff of
       comparing by identity, and the explanation for any count that looks off */
    renamed: both.filter(e => e.a.toLowerCase() !== e.b.toLowerCase()),
    /* card counts, not line counts: two lines can collapse to one card */
    counts: {a: left.size, b: right.size,
      both: both.length, onlyA: onlyA.length, onlyB: onlyB.length},
  };
}

/* A chosen bucket, in the shape plan() wants. */
export const selection = entries => new Map(entries.map(e => [e.a ?? e.b, e.card]));
