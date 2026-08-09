/* Pure HTML generation — no DOM reads, no event handling. */

const ARTHUE = ['#c8a45c','#5f9fd0','#79c088','#cf8fae','#8fa9d0','#d09a5b','#83c3b4','#b795cf','#c4b47e','#6fbfa8'];

export const esc = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export const tally = stats =>
  `<b>${stats.cards}</b> cards · <b>${stats.prints}</b> printings · <b>${stats.arts}</b> distinct arts`;

export const missingNote = missing => missing.length
  ? `${missing.length} name${missing.length>1?'s':''} had no match in Scryfall’s database, so they are not shown — `
    + 'check the spelling, or they may not be released yet: '
    + missing.map(m => `<code>${esc(m)}</code>`).join(' ')
  : '';

/* What the loader is doing, and how far through it is. Each phase stays on
   screen once it has run, so the work reads as a sequence with a shape rather
   than one line flickering past. The phases count different things, so each
   carries its own unit; a finished one drops the count for what it came back
   with, which is the more interesting number. */
export const steps = list => list.map(s => {
  const running = s.done < s.total;
  return `<li class="step ${running ? 'now' : 'done'}">
    <span class="mark" aria-hidden="true">${running ? '·' : '✓'}</span>
    <span class="what">${esc(s.label)}</span>
    <span class="tick">${running || !s.note
      ? `${s.done} of ${s.total} ${esc(s.unit)}` : esc(s.note)}</span>
  </li>`;
}).join('');

/* The verdict on each pasted name. Only the ones that needed a second look are
   listed — a wall of ticks for names that simply worked says nothing — so the
   count carries the rest. A cross is a name nothing matched; a tick against a
   different name is a card found under an alternate name, which is a guess
   worth showing rather than quietly applying. */
export function report(rows, {rename = true} = {}){
  const bad = rows.filter(r => r.status !== 'ok');
  const head = `<p class="sum"><b>${rows.length - bad.length}</b> of `
    + `<b>${rows.length}</b> name${rows.length > 1 ? 's' : ''} matched exactly.</p>`;
  if (!bad.length) return head;
  return head + '<ul class="checks">' + bad.map(r => r.status === 'alt'
    ? `<li class="check alt"><span class="mark" aria-label="found">✓</span>
        <span class="who"><s>${esc(r.input)}</s> is a printing of <b>${esc(r.name)}</b></span>
        ${rename ? `<button class="tog" data-rename="${esc(r.input)}" data-to="${esc(r.name)}">Use this name</button>` : ''}</li>`
    : `<li class="check miss"><span class="mark" aria-label="not found">✗</span>
        <span class="who">${esc(r.input)}</span>
        <span class="why">no match — check the spelling</span></li>`).join('') + '</ul>';
}

/* Cards that resolved but have nothing to show — digital-only printings. They
   would otherwise just be absent, with the tally quietly one short. */
export const droppedNote = dropped => dropped?.length
  ? `${dropped.length} card${dropped.length > 1 ? 's have' : ' has'} no English paper printing, `
    + 'so nothing is shown for them: '
    + dropped.map(d => `<code>${esc(d)}</code>`).join(' ')
  : '';

/* ---- cubes ---- */

/* What the CubeCobra fetch did, in words, with a way back. Replacing a list is
   reversible, so it gets an Undo rather than a confirmation to click through. */
export const pasted = ({title, count, replaced}) =>
  `<b>${esc(title)}</b> — ${count} name${count === 1 ? '' : 's'} `
  + `${replaced ? 'replaced the list' : 'pasted'} below. Edit them freely, then Load.`
  + (replaced ? '<button class="tog" data-undo>Undo</button>' : '');

/* The line a cube slot shows when collapsed, so its summary carries the
   outcome and the slot can be folded away. */
export const cubeStat = ({names, missing = 0, alts = 0}) => {
  if (!names) return '';
  const said = [];
  if (missing) said.push(`${missing} unmatched`);
  if (alts) said.push(`${alts} under another name`);
  return `${names} name${names === 1 ? '' : 's'}`
    + (said.length ? `, ${said.join(', ')}` : ', all matched');
};

/* ---- what is remembered ---- */

/* The cubes that have been pulled before, offered under every cube field.
   Clicking one fills the field and stops there — the field is what gets
   fetched, the same way the textarea is what gets loaded — so these are
   suggestions rather than shortcuts past a step. */
export const cubeChips = list => list.length
  ? `<span class="was">Looked up before</span>`
    + list.map(c => `<button class="tog" data-cube="${esc(c.id)}" title="${esc(c.id)}"
        >${esc(c.title || c.id)}</button>`).join('')
  : '';

/* The last list typed by hand, offered back after something else has taken the
   textarea over. Only shown when there is one and it is not already there. */
export const typedChip = count =>
  `<span class="was">Your last typed list</span>
   <button class="tog" data-typed>${count} name${count === 1 ? '' : 's'}</button>`;

/* What the cache is costing, said on hover over Clear cache. Megabytes past a
   megabyte, since past that point the second decimal is noise. */
export function cacheSize({bytes, names, prints, symbols}){
  if (!bytes) return 'Nothing cached yet';
  const size = bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
    : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  const said = [[names, 'card name'], [prints, 'printing list'], [symbols, 'set symbol']]
    .filter(([n]) => n)
    .map(([n, what]) => `${n} ${what}${n === 1 ? '' : 's'}`);
  return `Cached: ${size} · ${said.join(' · ')}`;
}

/* The three ways to look at two cubes. Named in both directions, because
   "only in X" and "missing from Y" are the same fact and different people
   reach for different halves of it.

   The radio row and the preview are siblings: a control inside a <summary>
   would toggle the disclosure when clicked. */

/* One picture of the comparison, drawn to scale, with each option shading the
   part of it that option would show. Each circle's area is its cube's card
   count and the lens between them is what the two share, so the diagram
   carries the counts rather than illustrating them — two cubes that barely
   overlap look it. A on the left, B on the right, the same way round on every
   row. It says what the label says and says it faster, which is also why it is
   decorative: nothing here is announced. */

/* The area two circles have in common: two circular segments back to back. */
const lens = (r1, r2, d) => {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return r1 * r1 * (a1 - Math.sin(a1) * Math.cos(a1))
       + r2 * r2 * (a2 - Math.sin(a2) * Math.cos(a2));
};

/* How far apart the centres have to be for the lens to come out at `want`.
   There is no closed form, but the lens shrinks steadily as the circles part,
   so the answer is pinned between full containment and no contact at all. */
function separation(r1, r2, want){
  let lo = Math.abs(r1 - r2), hi = r1 + r2;
  if (want >= lens(r1, r2, lo)) return lo;      // one cube contains the other
  if (want <= 0) return hi * 1.05;              // nothing shared — stand them apart
  for (let i = 0; i < 50; i++){
    const mid = (lo + hi) / 2;
    if (lens(r1, r2, mid) > want) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const TALL = 36, PAD = 1;    // drawn height, and room for the stroke either side
const THIN = 6;              // the narrowest crescent still worth drawing

/* Radii go as the square root of the count, so it is the areas that compare —
   over π, so that an area *is* a count and the lens can be solved for `both`
   directly. The whole thing is then scaled to a fixed height and cropped to
   what it covers, which is why the three rows come out the same size. */
function geometry({both, onlyA, onlyB}){
  const size = n => Math.sqrt(n / Math.PI);
  const r1 = size(both + onlyA), r2 = size(both + onlyB);
  if (!r1 || !r2) return null;
  const s = TALL / (2 * Math.max(r1, r2));

  /* Two cubes that are nearly the same cube draw as nearly the same circle,
     and a crescent under a couple of pixels reads as no crescent at all —
     which would leave two of the three options looking identical and empty.
     So the circles are pulled apart far enough for each slice a cube actually
     has to be visible. It understates the overlap rather than inventing one,
     and only bites where the exact drawing would say nothing. */
  const floor = Math.min(
    Math.max(onlyA ? THIN / s + r2 - r1 : 0, onlyB ? THIN / s + r1 - r2 : 0),
    (r1 + r2) * .9);
  const d = Math.max(separation(r1, r2, both), floor);

  /* Either circle can be the outermost one — a cube can contain the other. */
  const left = Math.min(-r1, d - r2), right = Math.max(r1, d + r2);
  return {
    a: {x: PAD + s * -left, r: s * r1},
    b: {x: PAD + s * (d - left), r: s * r2},
    cy: PAD + TALL / 2,
    w: 2 * PAD + s * (right - left),
    h: 2 * PAD + TALL,
  };
}

/* The slice each option shades: the lens, or one circle with the other cut
   out. Clip paths and masks resolve by id, so each carries its own. */
function venn(key, g){
  if (!g) return '';
  const at = (c, more) => `<circle cx="${c.x.toFixed(2)}" cy="${g.cy.toFixed(2)}" r="${c.r.toFixed(2)}" ${more}/>`;
  const id = `venn-${key}`, hole = key === 'onlyB' ? g.a : g.b;
  const box = `width="${g.w.toFixed(2)}" height="${g.h.toFixed(2)}"`;
  const defs = key === 'both'
    ? `<clipPath id="${id}">${at(g.b, '')}</clipPath>`
    : `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" ${box}>
         <rect ${box} fill="#fff"/>${at(hole, 'fill="#000"')}</mask>`;
  const paint = key === 'both'
    ? at(g.a, `class="on" clip-path="url(#${id})"`)
    : at(key === 'onlyA' ? g.a : g.b, `class="on" mask="url(#${id})"`);

  return `<svg class="venn" viewBox="0 0 ${g.w.toFixed(2)} ${g.h.toFixed(2)}"
      aria-hidden="true" focusable="false"><defs>${defs}</defs>
      ${paint}${at(g.a, 'class="ring"')}${at(g.b, 'class="ring"')}</svg>`;
}

export function buckets(list, a, b){
  const say = {
    both: [`In <b>both</b> cubes`, `${esc(a)} ∩ ${esc(b)}`],
    onlyA: [`Only in <b>${esc(a)}</b>`, `missing from ${esc(b)}`],
    onlyB: [`Only in <b>${esc(b)}</b>`, `missing from ${esc(a)}`],
  };
  /* All three rows draw the same two circles — only the shading differs, which
     is what makes them read as one picture seen three ways. */
  const n = Object.fromEntries(list.map(({key, names}) => [key, names.length]));
  const g = geometry({both: n.both || 0, onlyA: n.onlyA || 0, onlyB: n.onlyB || 0});

  return list.map(({key, names}) => {
    const [what, who] = say[key];
    return `<li class="bucket">
      <label class="pick-row">
        <input type="radio" name="bucket" value="${key}"${names.length ? '' : ' disabled'}>
        <span class="what">${what}<span class="who">${who}</span></span>
        <span class="n">${names.length}</span>
        ${venn(key, g)}
      </label>
      ${names.length ? `<details class="peek">
        <summary>Preview ${names.length} card${names.length === 1 ? '' : 's'}</summary>
        <div class="names">${names.map(n => `<span>${esc(n)}</span>`).join('')}</div>
      </details>` : ''}
    </li>`;
  }).join('');
}

const SAY = {both: 'In both cubes', onlyA: 'Only in ', onlyB: 'Only in '};

/* The pill in the masthead — short, because it sits beside the title. */
export const diffTag = (key, a, b) =>
  key === 'both' ? SAY.both : SAY[key] + (key === 'onlyA' ? a : b);

/* The sentence above the gallery, which has room to give the whole shape. */
export const diffNote = (key, a, b, counts) => {
  const n = counts[key];
  const head =
    key === 'both'
      ? `Showing the <b>${n}</b> card${n === 1 ? '' : 's'} <b>${esc(a)}</b> and <b>${esc(b)}</b> share.`
      : key === 'onlyA'
        ? `Showing the <b>${n}</b> card${n === 1 ? '' : 's'} <b>${esc(a)}</b> has that <b>${esc(b)}</b> does not.`
        : `Showing the <b>${n}</b> card${n === 1 ? '' : 's'} <b>${esc(b)}</b> has that <b>${esc(a)}</b> does not.`;
  return `${head} The two share ${counts.both}; ${esc(a)} has ${counts.onlyA} of its own, `
    + `${esc(b)} has ${counts.onlyB}.`;
};

/* Five of the groups are a mana colour and wear its symbol; colourless takes
   the {C} symbol. Multicolour and lands are categories rather than mana, so
   they get a plain disc in the colour the page already uses for them. */
const MANA = {w:'W', u:'U', b:'B', r:'R', g:'G', c:'C'};
const pip = key => MANA[key]
  ? `<img class="pip" src="https://svgs.scryfall.io/card-symbols/${MANA[key]}.svg" alt="">`
  : `<span class="pip" style="background:var(--${key})"></span>`;

/* the jump nav is symbols alone — the sections below carry the names */
export const nav = groups => groups.map(([name, key]) =>
  `<a href="#g-${key}" title="${esc(name)}" aria-label="Jump to ${esc(name)}">${pip(key)}</a>`)
  .join('');

function tile(p, dupes, src){
  const hue = ARTHUE[p.x % ARTHUE.length];
  const price = p.p ? '$' + p.p : '';
  const chips = [`<span class="chip art">art ${p.x+1}</span>`]
    .concat(p.t.map(t => `<span class="chip">${esc(t)}</span>`)).join('');
  return `<a class="card" href="${esc(p.u)}" target="_blank" rel="noopener"
      style="--hue:${hue}" aria-label="${esc(p.sn)} printing of this card, art by ${esc(p.a)}">
    <div class="shot">
      <img src="${esc(src[p.i])}" alt="${esc(p.sn)} printing, art by ${esc(p.a)}" loading="lazy" decoding="async">
      ${dupes ? `<span class="stack">+${dupes}</span>` : ''}
      <div class="plate">
        <div class="p1">${esc(p.s)} <em>${esc(p.y)}</em>${price ? `<em style="margin-left:auto">${price}</em>` : ''}</div>
        <div class="p2">${esc(p.a)}</div>
      </div>
    </div>
    <div class="cap">
      <div class="c1">${esc(p.s)} <em>${esc(p.y)}</em>${price ? `<span class="price">${price}</span>` : ''}</div>
      <div class="c2">${esc(p.sn)} &middot; #${esc(p.n)}</div>
      <div class="c3">${esc(p.a)}</div>
      <div class="chips">${chips}</div>
      ${dupes ? `<div class="dupes">+${dupes} more printing${dupes>1?'s':''} of this art</div>` : ''}
    </div>
  </a>`;
}

/* One symbol per set the card appeared in, oldest first. A set shows twice only
   if the card was printed there at two rarities. */
function symbols(c, sets){
  const seen = new Set(), out = [];
  for (const p of c.prints || []){
    const key = p.s + '/' + p.r;
    if (seen.has(key)) continue;
    seen.add(key);
    const set = sets[p.s];
    if (!set?.svg) continue;
    const label = `${set.name} · ${p.r}`;
    out.push(`<span class="sym r-${esc(p.r)}" data-set="${esc(label)}" role="img" aria-label="${esc(label)}"
      >${set.svg}</span>`);
  }
  return out.length ? `<div class="sets">${out.join('')}</div>` : '';
}

/* Set and artist are only searchable once a card's printings have arrived; its
   own name and type are there from the start. */
function matches(c, q){
  const hay = (c.name + ' ' + (c.alt || '') + ' ' + c.type + ' ' +
    (c.prints || []).map(p => p.s + ' ' + p.sn + ' ' + p.a).join(' ')).toLowerCase();
  return hay.includes(q);
}

/* One entry per tile: the printing to show, plus how many further printings
   share its art (collapsed away when `uniq` is on). */
function tiles(c, uniq){
  if (!uniq) return c.prints.map(p => ({p, n:0}));
  const first = new Map();
  for (const p of c.prints){
    if (!first.has(p.x)) first.set(p.x, {p, n:0});
    else first.get(p.x).n++;
  }
  return [...first.values()];
}

/* A row whose printings have not arrived stands in with a few blank tiles, so
   the page has its shape from the start and the real ones drop in without
   shifting what is being read. */
const GHOSTS = 3;

function strip(c, uniq, src){
  if (c.prints === null)
    return Array.from({length: GHOSTS},
      (_, i) => `<div class="ghost" style="--i:${i}"></div>`).join('');
  if (!c.prints.length)
    return '<div class="none">No English paper printing of this card.</div>';
  return tiles(c, uniq).map(v => tile(v.p, v.n, src)).join('');
}

/* One card's row. Separate from gallery() so a card can be redrawn on its own
   when its printings land, rather than rebuilding the page around it. */
export const row = (c, {uniq, src, sets}) =>
  `<section class="row" data-card="${esc(c.id)}" style="--hue:var(--${c.b})">
    <div class="rail">
      <div class="title serif">${esc(c.name)}</div>
      ${c.alt ? `<div class="aka">listed as “${esc(c.alt)}”</div>` : ''}
      ${symbols(c, sets)}
    </div>
    <div class="strip">${strip(c, uniq, src)}</div>
  </section>`;

/* Returns the gallery markup plus the colour groups it emitted, in order. */
export function gallery(cards, opts){
  let html = '', group = null;
  const groups = [];
  for (const c of cards){
    if (opts.query && !matches(c, opts.query)) continue;
    if (c.bn !== group){
      group = c.bn;
      groups.push([c.bn, c.b]);
      html += `<h2 class="sect" id="g-${c.b}">${pip(c.b)}${c.bn}</h2>`;
    }
    html += row(c, opts);
  }
  return {html: html || '<div class="blank">No cards match that filter.</div>', groups};
}
