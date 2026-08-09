/* DOM wiring — reads the controls, writes the rendered markup, and moves
   between the screens: a typed list, a cube, two cubes compared, and the
   gallery any of them builds. */

import * as view from './render.js';
import * as cc from './cubecobra.js';
import * as api from './scryfall.js';
import {parse, resolveNames, plan, printsFor, symbolsFor, compare, selection, PHASE} from './data.js';
import {track} from './progress.js';

const $ = id => document.getElementById(id);
const SAVED = 'cp:list', CUBES = 'cp:cubes', MODE = 'cp:mode';
const SAMPLE = ['Thraben Inspector', 'Lightning Bolt', 'Birds of Paradise',
  'Delver of Secrets', 'Wear // Tear', 'Aetherling'].join('\n');

function toggle(id, fn){
  const el = $(id);
  el.addEventListener('click', () => {
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', String(on));
    fn(on);
  });
}

const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

/* A unit of work: one list of names with its own button, progress and report.
   The typed list, each cube being compared and the bucket loader are all the
   same shape, so they are all driven through this rather than through four
   copies of the same handler. Elements a unit does not have come back null and
   are simply not touched. */
function unit(prefix, rootId){
  const el = k => $(prefix + k);
  const root = $(rootId);
  const u = {
    root, list: el('list'), go: el('load'), bar: el('bar'), steps: el('steps'),
    phase: el('phase'), report: el('report'), count: el('count'),

    /* What the last run came back with, kept so a suggestion can be taken up
       without running it again. */
    got: null, rows: [],
    clean: () => u.rows.length > 0 && u.rows.every(r => r.status === 'ok'),

    reset(){
      if (u.report) u.report.innerHTML = '';
      u.steps.innerHTML = '';
      u.phase.textContent = '';
      u.bar.style.width = '0%';
      u.got = null;
      u.rows = [];
    },

    /* The button's wording belongs to the unit, not to the caller of the
       moment: a run that ends in an error has to put the button back without
       knowing what it said. */
    words: {busy: 'Loading…', idle: 'Load'},

    /* Disabling a button that currently has focus drops focus to the body and
       loses the reader's place, so the status line — which is where the news
       is about to appear anyway — takes it first. */
    state(s, words){
      Object.assign(u.words, words);
      if (s === 'working' && u.root.contains(document.activeElement))
        u.phase.focus?.({preventScroll: true});
      root.dataset.state = s;
      root.toggleAttribute('aria-busy', s === 'working');
      for (const c of root.querySelectorAll('textarea, input, button'))
        c.disabled = s === 'working';
      /* Nothing in flight can be cancelled, so leaving the screen mid-run
         would let a finished fetch write into a pane nobody is looking at. */
      for (const id of ['mode-text', 'mode-cube', 'mode-view', 'mode-diff'])
        $(id).disabled = s === 'working';
      u.go.textContent = s === 'working' ? u.words.busy : u.words.idle;
    },

    /* Progress and the tick/cross report both land here, whichever phases ran. */
    at(phases){
      const rows = [];
      return track(phases, step => {
        rows[step.index] = step;
        u.bar.style.width = (step.fraction * 100).toFixed(1) + '%';
        u.steps.innerHTML = view.steps(rows.filter(Boolean));
      });
    },

    /* Not 'idle' — that hides the progress block the message is sitting in. */
    fail(err){
      console.error(err);
      u.phase.innerHTML = `<span class="bad">${view.esc(err.message)}</span>`;
      u.state('done');
    },
  };
  return u;
}

export async function init(){
  let data = null, uniq = true, origin = 'list';
  const cube = {a: null, b: null};      // resolved sides, once each has run
  const cubeId = {a: null, b: null};    // what CubeCobra called each one
  let diff = null, baseNote = '', pending = null;

  const opts = () => ({
    query: $('q').value.trim().toLowerCase(), uniq, src: data.src, sets: data.sets,
  });

  const render = () => {
    if (!data) return;
    const {html, groups} = view.gallery(data.db.cards, opts());
    $('out').innerHTML = html;
    $('nav').innerHTML = view.nav(groups);
  };

  /* ---- filling the gallery in ---- */

  /* Resolving the names is the only part worth waiting for. The printings
     arrive afterwards, into a page that is already on screen: each card holds
     a few blank tiles until its own row can be redrawn. */
  let waiting = new Set(), loading = false;

  /* Whatever is on screen is what someone is looking at, so it is fetched
     next. Worked out fresh each time a batch is about to go out rather than
     tracked as the page moves: one pass over the rows still waiting costs
     nothing beside the request it precedes, and it can never be stale. */
  function nextBatch(){
    const middle = innerHeight / 2, ranked = [], placed = new Set();
    for (const el of $('out').querySelectorAll('.row[data-card]')){
      const id = el.dataset.card;
      if (!waiting.has(id) || placed.has(id)) continue;
      placed.add(id);
      const box = el.getBoundingClientRect();
      ranked.push([Math.abs(box.top + box.height / 2 - middle), id]);
    }
    ranked.sort((a, b) => a[0] - b[0]);
    const batch = ranked.slice(0, api.CARDS_PER_SEARCH).map(([, id]) => id);

    /* A card whose row is not on the page — filtered out by a search — still
       has to be fetched, just last. */
    for (const id of waiting){
      if (batch.length === api.CARDS_PER_SEARCH) break;
      if (!placed.has(id)) batch.push(id);
    }
    return batch;
  }

  const byId = id => data.db.cards.find(c => c.id === id);

  /* Redrawing one row leaves the rest of the page — and the scroll position —
     exactly where it was. A row filtered out by a search simply is not there. */
  function redraw(ids){
    for (const id of ids){
      const el = $('out').querySelector(`.row[data-card="${CSS.escape(id)}"]`);
      const card = byId(id);
      if (el && card) el.outerHTML = view.row(card, opts());
    }
  }

  function progress(){
    const total = data.db.cards.length, left = waiting.size;
    $('loading').textContent = left ? `loading printings · ${total - left} of ${total}` : '';
    $('tally').innerHTML = view.tally(data.db.stats);
    /* Recomposed rather than appended, since cards with nothing to show turn
       up a batch at a time. */
    $('note').innerHTML = [baseNote, view.droppedNote(data.db.dropped)]
      .filter(Boolean).join('<br>');
  }

  async function fill(){
    if (loading) return;
    loading = true;
    try {
      while (waiting.size){
        const batch = nextBatch();
        let got;
        try {
          got = await printsFor(batch, data.src);
        } catch (err) {
          console.error(err);
          $('loading').innerHTML = `<span class="bad">${view.esc(err.message)}</span>`;
          return;
        }
        for (const id of batch) waiting.delete(id);

        const codes = new Set();
        for (const [id, {prints, arts}] of got){
          const card = byId(id);
          if (!card) continue;
          card.prints = prints;
          card.arts = arts;
          data.db.stats.prints += prints.length;
          data.db.stats.arts += arts;
          if (!prints.length) data.db.dropped.push(card.name);
          for (const p of prints) codes.add(p.s);
        }
        redraw(batch);
        progress();
        /* Symbols are cheap and unlimited, so they chase each batch rather
           than waiting for the whole run; the rows they belong to are redrawn
           again once they land. */
        symbolsFor([...codes], data.sets)
          .then(added => { if (added.length) redraw(batch); })
          .catch(err => console.error(err));
      }
    } finally {
      loading = false;
      progress();
    }
  }

  /* Opens the gallery on a resolved list and starts filling it in. */
  function open(resolved, alts, {missing = [], diffCtx = null} = {}){
    const cards = plan(resolved, alts);
    data = {
      db: {cards, missing, dropped: [], stats: {cards: cards.length, prints: 0, arts: 0}},
      src: {}, sets: data?.sets ?? {},
    };
    waiting = new Set(cards.map(c => c.id));
    toGallery(diffCtx);
    progress();
    show('gallery');
    fill();
    return cards.length;
  }

  const load = unit('', 'view-load');
  const sides = {a: unit('a-', 'cube-a'), b: unit('b-', 'cube-b')};

  /* ---- screens ---- */

  const show = v => {
    document.body.dataset.view = v;
    scrollTo(0, 0);
    if (v !== 'gallery') origin = v;
    ($(v === 'diff' ? 'a-src' : v === 'gallery' ? 'q' : 'list'))
      ?.focus({preventScroll: true});
  };

  const mode = v => {
    save(MODE, v);
    $('mode-text').setAttribute('aria-pressed', String(v === 'list'));
    $('mode-cube').setAttribute('aria-pressed', String(v !== 'list'));
    $('mode-view').setAttribute('aria-pressed', String(v === 'cube'));
    $('mode-diff').setAttribute('aria-pressed', String(v === 'diff'));
    show(v);
    link();
  };

  /* The address bar is the share affordance: the cubes on screen are always in
     it, so copying the URL hands someone else the same comparison. Ids are
     preferred over whatever was typed, so a pasted link shares as a tidy one. */
  function link(){
    const v = document.body.dataset.view;
    const q = new URLSearchParams();
    const put = (key, id, field) => {
      const value = id || $(field).value.trim();
      if (value) q.set(key, value);
    };
    if (v === 'diff'){
      put('a', cubeId.a, 'a-src');
      put('b', cubeId.b, 'b-src');
    } else if (v === 'cube'){
      put('cube', cubeId.one, 'cube');
    }
    history.replaceState(null, '', q.size ? '?' + q : location.pathname);
  }

  const counted = u => {
    const n = parse(u.list.value).length;
    u.count.textContent = n ? `${n} name${n === 1 ? '' : 's'}` : '';
  };

  /* ---- fetching a cube ---- */

  /* Fetch fills a textarea and stops there. The names stay editable and the
     textarea stays the thing that gets loaded, so a cube is a starting point
     rather than a mode you are locked into. */
  async function fetchCube(srcId, noteId, u, onTitle){
    const src = $(srcId), note = $(noteId), btn = src.nextElementSibling;
    const before = u.list.value;
    note.innerHTML = '';
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = 'Fetching…';
    try {
      const got = await cc.cube(src.value);
      const names = parse(got.text);
      u.list.value = names.join('\n');
      counted(u);
      note.innerHTML = view.pasted({title: got.title, count: names.length, replaced: !!before.trim()});
      note.dataset.before = before;
      onTitle?.(got);
      return got;
    } catch (err) {
      note.innerHTML = `<span class="bad">${view.esc(err.message)}</span>`;
      return null;
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  }

  /* ---- the typed-list / single-cube screen ---- */

  async function runLoad(){
    const names = parse(load.list.value);
    if (!names.length){ load.list.focus(); return; }
    load.list.value = names.join('\n');
    save(SAVED, load.list.value);
    load.reset();
    pending = null;
    load.state('working', {busy: 'Loading…', idle: 'Load'});

    let got;
    try {
      const at = load.at([PHASE.find, PHASE.alt]);
      got = await resolveNames(names, {
        at, onReport: rows => {
          load.rows = rows;
          load.report.innerHTML = view.report(rows);
        },
      });
      load.got = got;
    } catch (err) { load.fail(err); return; }

    load.state('idle');
    if (!got.resolved.size){
      load.phase.innerHTML = '<span class="bad">None of those names matched a card.</span>';
      load.state('done');
      return;
    }
    /* Anything worth reviewing keeps you here; the gallery is one click away
       and loses nothing by waiting. */
    if (!load.clean()){
      pending = () => open(got.resolved, got.alts, {missing: got.missing});
      load.state('review');
      return;
    }
    open(got.resolved, got.alts, {missing: got.missing});
  }

  /* ---- comparing two cubes ---- */

  /* A side is settled once its list is final — resolved with nothing left to
     look at, or with what is left explicitly accepted. Comparing half-finished
     lists would put counts on screen that are about to change. */
  const settled = {a: false, b: false};

  /* Any edit invalidates the comparison, so the chooser withdraws rather than
     letting a stale set of buckets be loaded. */
  const stale = key => {
    const u = sides[key];
    cube[key] = null;
    settled[key] = false;
    diff = null;
    /* The rendered report stays as a record of what the last run said — it is
       what someone is reading while they fix a name — but the result behind it
       goes, so nothing can be settled on the strength of it. */
    u.got = null;
    u.rows = [];
    u.root.dataset.state = 'idle';
    $(key + '-stat').textContent = '';
    $('pick').hidden = true;
    $('pick-load').disabled = true;
  };

  /* Collapsing a slot that holds the focused element would take that element
     out of the document, so the summary — which is what is left to read —
     takes focus first. */
  function fold(u){
    if (u.root.contains(document.activeElement))
      u.root.querySelector('summary').focus({preventScroll: true});
    u.root.open = false;
  }

  /* This side is final: fold it away and see whether the other one is too. */
  function settle(key){
    settled[key] = true;
    sides[key].state('done', {idle: 'Resolve again'});
    fold(sides[key]);
    offer();
  }

  const cubeStat = key => {
    const u = sides[key];
    $(key + '-stat').textContent = u.got ? view.cubeStat({
      names: parse(u.list.value).length,
      missing: u.got.missing.length,
      alts: u.got.alts.size,
    }) : '';
  };

  async function runSide(key){
    const u = sides[key];
    const names = parse(u.list.value);
    if (!names.length){ u.list.focus(); return; }
    u.list.value = names.join('\n');
    u.reset();
    settled[key] = false;
    u.state('working', {busy: 'Resolving…', idle: 'Resolve'});

    try {
      const at = u.at([PHASE.find, PHASE.alt]);
      cube[key] = u.got = await resolveNames(names, {
        at, onReport: rows => {
          u.rows = rows;
          u.report.innerHTML = view.report(rows);
        },
      });
    } catch (err) { u.fail(err); return; }

    cubeStat(key);
    /* A slot that came back clean is final and folds away; one with something
       to look at stays open until it is fixed or accepted. */
    if (u.clean()) settle(key);
    else {
      u.state('review', {idle: 'Resolve again'});
      offer();
    }
  }

  function offer(){
    $('pick').hidden = true;
    $('pick-load').disabled = true;
    if (!cube.a || !cube.b || !settled.a || !settled.b) return;
    diff = compare(cube.a.resolved, cube.b.resolved);
    const {counts} = diff;
    const names = key => diff[key].map(e => e.name);
    $('buckets').innerHTML = view.buckets(
      [{key: 'both', names: names('both')},
       {key: 'onlyA', names: names('onlyA')},
       {key: 'onlyB', names: names('onlyB')}],
      title('a'), title('b'));
    $('pick-sum').textContent =
      counts.both === counts.a && counts.both === counts.b
        ? 'These two cubes hold exactly the same cards.'
        : `${counts.both} shared · ${counts.onlyA} only in A · ${counts.onlyB} only in B`
          + (diff.renamed.length
            ? ` · ${diff.renamed.length} shared card${diff.renamed.length > 1 ? 's are' : ' is'} listed under different names`
            : '');
    $('pick').hidden = false;
    $('pick-load').disabled = true;
    $('pick-count').textContent = '';
  }

  /* A cube pasted in by hand never gets a name, so the slot's own label does. */
  const title = key => {
    const named = $(key + '-name').textContent.trim();
    return named && named !== 'not set' ? named : `Cube ${key.toUpperCase()}`;
  };
  const chosen = () => $('buckets').querySelector('input:checked')?.value;

  /* The cards in a bucket are already resolved, so choosing one opens the
     gallery outright — there is nothing left to wait for before browsing. */
  function runPick(){
    const key = chosen();
    if (!key || !diff) return;
    open(selection(diff[key]), new Set([...cube.a.alts, ...cube.b.alts]), {diffCtx: {key}});
  }

  /* ---- into the gallery ---- */

  function toGallery(diffCtx){
    $('tally').innerHTML = view.tally(data.db.stats);
    $('ctx').textContent = diffCtx ? view.diffTag(diffCtx.key, title('a'), title('b')) : '';
    $('edit-label').textContent = origin === 'diff' ? 'Edit cubes' : 'Edit list';
    baseNote = [
      diffCtx ? view.diffNote(diffCtx.key, title('a'), title('b'), diff.counts) : '',
      view.missingNote(data.db.missing),
    ].filter(Boolean).join('<br>');
    $('note').innerHTML = baseNote;
    render();
  }

  /* ---- wiring ---- */

  toggle('t-uniq', on => { uniq = on; document.body.classList.toggle('allprints', !on); render(); });
  toggle('t-detail', on => document.body.classList.toggle('detailed', on));
  toggle('t-wrap', on => document.body.classList.toggle('wrapped', on));
  $('q').addEventListener('input', render);
  $('size').addEventListener('input', e =>
    document.documentElement.style.setProperty('--tile', e.target.value + 'px'));

  /* The masthead folds down to its title. It is expanded/collapsed rather than
     pressed, so it stays outside toggle()'s aria-pressed convention. */
  $('t-bar').addEventListener('click', e => {
    const slim = document.body.classList.toggle('slim');
    const label = slim ? 'Show controls' : 'Hide controls';
    e.currentTarget.setAttribute('aria-expanded', String(!slim));
    e.currentTarget.setAttribute('aria-label', label);
    e.currentTarget.title = label;
  });

  /* The rail sticks below the masthead, whose height moves with collapsing,
     wrapping and the tally arriving — so it is measured rather than assumed. */
  new ResizeObserver(([entry]) => {
    const h = entry.target.offsetHeight;
    if (h) document.documentElement.style.setProperty('--bar', h + 'px');
  }).observe(document.querySelector('.bar'));

  $('mode-text').addEventListener('click', () => mode('list'));
  $('mode-cube').addEventListener('click', () =>
    mode($('mode-diff').getAttribute('aria-pressed') === 'true' ? 'diff' : 'cube'));
  $('mode-view').addEventListener('click', () => mode('cube'));
  $('mode-diff').addEventListener('click', () => mode('diff'));

  $('load').addEventListener('click', runLoad);
  $('go-on').addEventListener('click', () => pending?.());
  $('edit').addEventListener('click', () => show(origin));
  $('cube-get').addEventListener('click', () =>
    fetchCube('cube', 'cube-note', load, got => { cubeId.one = got.id; link(); }));
  $('cube').addEventListener('input', () => { cubeId.one = null; link(); });
  $('list').addEventListener('input', () => { save(SAVED, $('list').value); counted(load); });

  $('share').addEventListener('click', async () => {
    const note = $('share-note'), said = note.textContent;
    try {
      await navigator.clipboard.writeText(location.href);
      note.textContent = 'Link copied.';
    } catch {
      note.textContent = 'Could not copy — the link is in the address bar.';
    }
    setTimeout(() => { note.textContent = said; }, 2500);
  });

  for (const key of ['a', 'b']){
    const u = sides[key];
    $(key + '-get').addEventListener('click', () => {
      stale(key);
      fetchCube(key + '-src', key + '-note', u, got => {
        $(key + '-name').textContent = got.title;
        cubeId[key] = got.id;
        remember();
        link();
      });
    });
    $(key + '-load').addEventListener('click', () => runSide(key));
    $(key + '-on').addEventListener('click', () => settle(key));
    u.list.addEventListener('input', () => { stale(key); counted(u); remember(); });
    $(key + '-src').addEventListener('input', () => { cubeId[key] = null; remember(); link(); });
    /* Accepting a name leaves this side resolved, so the comparison stands —
       only the line it is listed under has changed. */
    wireRename(u, () => {
      counted(u);
      remember();
      cubeStat(key);
      if (u.clean()) settle(key);
    });
  }

  $('buckets').addEventListener('change', () => {
    const key = chosen();
    $('pick-load').disabled = !key;
    const n = diff?.[key]?.length ?? 0;
    $('pick-count').textContent = n
      ? `${n} card${n === 1 ? '' : 's'} · printings arrive as you browse` : '';
  });
  $('pick-load').addEventListener('click', runPick);

  wireRename(load, () => { save(SAVED, load.list.value); counted(load); });

  /* Taking up a suggested name settles it there and then. The card behind the
     suggestion is already in hand — the fuzzy lookup that found it is what
     produced the suggestion — so accepting it moves that card onto the name now
     on the line and turns the row into a tick. Nothing is looked up again, and
     there is no reason to run the list a second time. */
  function accept(u, from, to){
    const lines = u.list.value.split('\n');
    const i = lines.findIndex(l => l.trim() === from);
    if (i >= 0) lines[i] = to;
    u.list.value = lines.join('\n');

    /* The result behind the report may have been thrown away by an edit since
       it was drawn. Rewriting the line still stands on its own — it is what
       the next run will read — so only the settling part is skipped. */
    const card = u.got?.resolved.get(from);
    if (!card) return;
    u.got.resolved.delete(from);
    u.got.alts.delete(from);
    u.got.resolved.set(to, card);
    u.rows = u.rows.map(r => r.input === from ? {input: to, status: 'ok'} : r);

    /* Redrawing the report takes away the button that was just pressed, and
       with it the focus. The next suggestion is where a keyboard was heading
       anyway; failing that, the way on. */
    const refocus = u.report.contains(document.activeElement);
    u.report.innerHTML = view.report(u.rows);
    if (refocus)
      (u.report.querySelector('[data-rename]') || u.root.querySelector('.after button'))
        ?.focus({preventScroll: true});
  }

  function wireRename(u, after){
    u.report.addEventListener('click', e => {
      const btn = e.target.closest('[data-rename]');
      if (!btn) return;
      accept(u, btn.dataset.rename, btn.dataset.to);
      after();
    });
  }

  /* Undo on a replaced list, delegated so it works for either note. */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-undo]');
    if (!btn) return;
    const note = btn.closest('[id$="note"]');
    const u = note.id === 'cube-note' ? load : sides[note.id[0]];
    u.list.value = note.dataset.before ?? '';
    if (u === load) save(SAVED, u.list.value);
    else stale(note.id[0]);
    counted(u);
    note.innerHTML = '';
  });

  /* ---- restore ---- */

  function remember(){
    save(CUBES, JSON.stringify({
      a: {src: $('a-src').value, name: $('a-name').textContent, text: sides.a.list.value},
      b: {src: $('b-src').value, name: $('b-name').textContent, text: sides.b.list.value},
    }));
  }

  load.list.value = localStorage.getItem(SAVED) ?? SAMPLE;
  counted(load);
  try {
    const kept = JSON.parse(localStorage.getItem(CUBES) || 'null');
    for (const key of ['a', 'b']){
      if (!kept?.[key]) continue;
      $(key + '-src').value = kept[key].src || '';
      $(key + '-name').textContent = kept[key].name || 'not set';
      sides[key].list.value = kept[key].text || '';
      counted(sides[key]);
    }
  } catch {}

  load.state('idle');

  /* A shared link wins over whatever was last open here: someone followed it
     to see those cubes, so it pulls both lists and resolves them without being
     asked. Each side is still resolved on its own, in turn, so a name that
     needs attention stops at the cube it belongs to. */
  const q = new URLSearchParams(location.search);
  const shared = {a: q.get('a'), b: q.get('b'), one: q.get('cube')};
  if (shared.a || shared.b){
    mode('diff');
    const pulled = [];
    for (const key of ['a', 'b']){
      if (!shared[key]) continue;
      $(key + '-src').value = shared[key];
      const pull = await fetchCube(key + '-src', key + '-note', sides[key], got => {
        $(key + '-name').textContent = got.title;
        cubeId[key] = got.id;
        remember();
        link();
      });
      if (pull) pulled.push(key);
    }
    for (const key of pulled) await runSide(key);
  } else if (shared.one){
    mode('cube');
    $('cube').value = shared.one;
    await fetchCube('cube', 'cube-note', load, got => { cubeId.one = got.id; link(); });
  } else {
    mode(localStorage.getItem(MODE) || 'list');
  }
}
