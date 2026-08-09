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

/* The three ways to look at two cubes. Named in both directions, because
   "only in X" and "missing from Y" are the same fact and different people
   reach for different halves of it.

   The radio row and the preview are siblings: a control inside a <summary>
   would toggle the disclosure when clicked. */

/* Two overlapping circles with the slice this option would show filled in —
   A on the left, B on the right, the same way round on every row. It says the
   same thing as the label beside it and says it faster, which also makes it
   decorative: nothing here is announced. The clip path and masks are declared
   once in the document; only which circle gets painted differs. */
const SLICE = {
  both:  '<circle class="on" cx="17" cy="14" r="11" clip-path="url(#venn-and)"/>',
  onlyA: '<circle class="on" cx="17" cy="14" r="11" mask="url(#venn-not-b)"/>',
  onlyB: '<circle class="on" cx="31" cy="14" r="11" mask="url(#venn-not-a)"/>',
};

const venn = key => `<svg class="venn" viewBox="0 0 48 28" aria-hidden="true" focusable="false">
    ${SLICE[key]}
    <circle class="ring" cx="17" cy="14" r="11"/>
    <circle class="ring" cx="31" cy="14" r="11"/>
  </svg>`;

export function buckets(list, a, b){
  const say = {
    both: [`In <b>both</b> cubes`, `${esc(a)} ∩ ${esc(b)}`],
    onlyA: [`Only in <b>${esc(a)}</b>`, `missing from ${esc(b)}`],
    onlyB: [`Only in <b>${esc(b)}</b>`, `missing from ${esc(a)}`],
  };
  return list.map(({key, names}) => {
    const [what, who] = say[key];
    return `<li class="bucket">
      <label class="pick-row">
        <input type="radio" name="bucket" value="${key}"${names.length ? '' : ' disabled'}>
        ${venn(key)}
        <span class="what">${what}<span class="who">${who}</span></span>
        <span class="n">${names.length}</span>
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
