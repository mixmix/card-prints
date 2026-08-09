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

export const nav = groups => groups.map(([name, key]) =>
  `<a href="#g-${key}"><span class="pip" style="background:var(--${key})"></span>${name}</a>`).join('');

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
export function gallery(cards, {query, uniq, src}){
  let html = '', group = null;
  const groups = [];
  for (const c of cards){
    if (query && !matches(c, query)) continue;
    if (c.bn !== group){
      group = c.bn;
      groups.push([c.bn, c.b]);
      html += `<h2 class="sect" id="g-${c.b}"><span class="pip" style="background:var(--${c.b})"></span>${c.bn}</h2>`;
    }
    html += `<section class="row" style="--hue:var(--${c.b})">
      <div class="rail">
        <div class="title serif">${esc(c.name)}</div>
        ${c.alt ? `<div class="aka">listed as “${esc(c.alt)}”</div>` : ''}
        <div class="sub">${esc(c.type)}${c.mana ? ' · ' + esc(c.mana) : ''}</div>
        <div class="count"><b>${c.prints.length}</b> printing${c.prints.length>1?'s':''} · <b>${c.arts}</b> art${c.arts>1?'s':''}</div>
      </div>
      <div class="strip">${tiles(c, uniq).map(v => tile(v.p, v.n, src)).join('')}</div>
    </section>`;
  }
  return {html: html || '<div class="blank">No cards match that filter.</div>', groups};
}
