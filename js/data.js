/* Turns a pasted list of card names into the shape the gallery renders:
   resolve the names, fetch every printing, then group, index and sort them. */

import * as api from './scryfall.js';

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

/* Resolution runs in three passes, each cheaper per name than the last is
   forgiving, so almost everything is settled by the first bulk request. */
async function resolve(names, step){
  const cards = new Map();
  let missed = [];

  for (let i = 0; i < names.length; i += api.NAMES_PER_LOOKUP){
    const batch = names.slice(i, i + api.NAMES_PER_LOOKUP);
    const got = await lookup(batch);
    for (const [name, card] of got.cards) cards.set(name, card);
    missed.push(...got.missed);
    step((i + batch.length) / names.length);
  }

  /* `/cards/collection` matches either half of a split card but not the joined
     "Wear // Tear" form the card is actually filed under, so a miss with a
     slash in it has earned one more attempt. */
  const splits = missed.filter(n => n.includes('//'));
  const faces = splits.map(n => n.split('//')[0].trim());
  for (let i = 0; i < splits.length; i += api.NAMES_PER_LOOKUP){
    const {cards: got} = await lookup(faces.slice(i, i + api.NAMES_PER_LOOKUP));
    splits.slice(i, i + api.NAMES_PER_LOOKUP).forEach((name, j) => {
      const card = got.get(faces[i + j]);
      if (card) cards.set(name, card);
    });
  }
  if (splits.length) missed = missed.filter(n => !cards.has(n));

  return {cards, missed};
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

async function assemble(resolved, alts, step){
  /* Two spellings of the same card collapse into one row, so group by identity
     rather than by the line that was typed. */
  const byOracle = new Map();
  for (const [input, card] of resolved){
    const id = card.oracle_id || (card.card_faces || [])[0]?.oracle_id || card.id;
    if (!byOracle.has(id)) byOracle.set(id, {card, inputs: []});
    byOracle.get(id).inputs.push(input);
  }

  const ids = [...byOracle.keys()], prints = new Map();
  for (let i = 0; i < ids.length; i += api.CARDS_PER_SEARCH){
    for (const p of await api.printings(ids.slice(i, i + api.CARDS_PER_SEARCH))){
      if (!prints.has(p.oracle_id)) prints.set(p.oracle_id, []);
      prints.get(p.oracle_id).push(p);
    }
    step(Math.min(i + api.CARDS_PER_SEARCH, ids.length) / ids.length);
  }

  const src = {}, cards = [];
  for (const [id, {card, inputs}] of byOracle){
    const list = prints.get(id);
    if (!list?.length) continue;
    const arts = new Map(), key = group(card);
    cards.push({
      name: card.name,
      type: card.type_line || '',
      mana: card.mana_cost
        || (card.card_faces || []).map(f => f.mana_cost).filter(Boolean).join(' // '),
      b: key, bn: NAME.get(key),
      prints: list.map(p => printing(p, arts, src)),
      arts: arts.size,
      /* the name the list used, when it was not the one Scryfall files the
         card under — the gallery prints it under the title */
      alt: inputs.find(n => alts.has(n)) || '',
    });
  }
  cards.sort((a, b) => ORDER.get(a.b) - ORDER.get(b.b) || a.name.localeCompare(b.name));
  return {cards, src};
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
const CACHE = 'cp:sym:';

async function toSymbols(codes, all, done){
  const sets = {}, queue = [...codes];
  const worker = async () => {
    for (let code; (code = queue.shift()) !== undefined; ){
      const set = all[code];
      if (set){
        const cached = localStorage.getItem(CACHE + code);
        let svg = cached;
        if (!svg) try {
          const res = await fetch(set.icon);
          if (res.ok) svg = geometry(await res.text());
        } catch { /* offline, blocked, or malformed — draw nothing */ }
        if (svg){
          sets[code] = {name: set.name, svg};
          if (!cached) try { localStorage.setItem(CACHE + code, svg); } catch {}
        }
      }
      done();
    }
  };
  await Promise.all(Array.from({length: 8}, worker));
  return sets;
}

/* ---- the whole job ---- */

/* Weighted rather than counted, because how big the later phases are is not
   known until the earlier ones have run. */
const PHASES = [
  ['Looking up names', .18],
  ['Checking alternate names', .10],
  ['Fetching printings', .47],
  ['Fetching set symbols', .25],
];

export async function build(names, {onProgress, onReport}){
  const at = (n, f = 0) => onProgress(
    PHASES.slice(0, n).reduce((total, [, weight]) => total + weight, 0)
      + PHASES[n][1] * Math.min(f, 1),
    PHASES[n][0]);

  at(0);
  const {cards: resolved, missed} = await resolve(names, f => at(0, f));

  /* Anything still unmatched gets one fuzzy lookup each — that is what finds a
     card listed under an alternate printed name. These are one-at-a-time and
     rate limited, so they are also the slowest thing here; by this point there
     should be very few left. */
  at(1);
  const alts = new Set();
  for (const [i, name] of missed.entries()){
    const card = await api.named(name);
    if (card){
      resolved.set(name, card);
      alts.add(name);
    }
    at(1, (i + 1) / missed.length);
  }

  onReport(names.map(name =>
    !resolved.has(name) ? {input: name, status: 'miss'}
    : alts.has(name) ? {input: name, status: 'alt', name: resolved.get(name).name}
    : {input: name, status: 'ok'}));

  at(2);
  const {cards, src} = await assemble(resolved, alts, f => at(2, f));

  at(3);
  const codes = [...new Set(cards.flatMap(c => c.prints.map(p => p.s)))];
  const all = await api.sets();
  let done = 0;
  const sets = await toSymbols(codes, all, () => at(3, ++done / codes.length));
  onProgress(1, 'Done');

  return {
    db: {
      cards,
      missing: names.filter(n => !resolved.has(n)),
      stats: {
        cards: cards.length,
        prints: cards.reduce((n, c) => n + c.prints.length, 0),
        arts: cards.reduce((n, c) => n + c.arts, 0),
      },
    },
    src, sets,
  };
}
