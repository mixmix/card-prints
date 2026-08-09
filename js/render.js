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

/* The verdict on each pasted name. Only the ones that needed a second look are
   listed — a wall of ticks for names that simply worked says nothing — so the
   count carries the rest. A cross is a name nothing matched; a tick against a
   different name is a card found under an alternate name, which is a guess
   worth showing rather than quietly applying. */
export function report(rows){
  const bad = rows.filter(r => r.status !== 'ok');
  const head = `<p class="sum"><b>${rows.length - bad.length}</b> of `
    + `<b>${rows.length}</b> name${rows.length > 1 ? 's' : ''} matched exactly.</p>`;
  if (!bad.length) return head;
  return head + '<ul class="checks">' + bad.map(r => r.status === 'alt'
    ? `<li class="check alt"><span class="mark" aria-label="found">✓</span>
        <span class="who"><s>${esc(r.input)}</s> is a printing of <b>${esc(r.name)}</b></span>
        <button class="tog" data-rename="${esc(r.input)}" data-to="${esc(r.name)}">Use this name</button></li>`
    : `<li class="check miss"><span class="mark" aria-label="not found">✗</span>
        <span class="who">${esc(r.input)}</span>
        <span class="why">no match — check the spelling</span></li>`).join('') + '</ul>';
}

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
  for (const p of c.prints){
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

function matches(c, q){
  const hay = (c.name + ' ' + (c.alt || '') + ' ' + c.type + ' ' +
    c.prints.map(p => p.s + ' ' + p.sn + ' ' + p.a).join(' ')).toLowerCase();
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

/* Returns the gallery markup plus the colour groups it emitted, in order. */
export function gallery(cards, {query, uniq, src, sets}){
  let html = '', group = null;
  const groups = [];
  for (const c of cards){
    if (query && !matches(c, query)) continue;
    if (c.bn !== group){
      group = c.bn;
      groups.push([c.bn, c.b]);
      html += `<h2 class="sect" id="g-${c.b}">${pip(c.b)}${c.bn}</h2>`;
    }
    html += `<section class="row" style="--hue:var(--${c.b})">
      <div class="rail">
        <div class="title serif">${esc(c.name)}</div>
        ${c.alt ? `<div class="aka">listed as “${esc(c.alt)}”</div>` : ''}
        ${symbols(c, sets)}
      </div>
      <div class="strip">${tiles(c, uniq).map(v => tile(v.p, v.n, src)).join('')}</div>
    </section>`;
  }
  return {html: html || '<div class="blank">No cards match that filter.</div>', groups};
}
