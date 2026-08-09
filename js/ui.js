/* DOM wiring — reads the controls, writes the rendered markup, and moves
   between the two views: the list you paste into, and the gallery it builds. */

import * as view from './render.js';
import {parse, build} from './data.js';

const $ = id => document.getElementById(id);
const SAVED = 'cp:list';
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

export function init(){
  let data = null, uniq = true;

  const render = () => {
    if (!data) return;
    const {html, groups} = view.gallery(data.db.cards, {
      query: $('q').value.trim().toLowerCase(), uniq, src: data.src, sets: data.sets,
    });
    $('out').innerHTML = html;
    $('nav').innerHTML = view.nav(groups);
  };

  const show = v => {
    document.body.dataset.view = v;
    scrollTo(0, 0);
    (v === 'list' ? $('list') : $('q')).focus({preventScroll: true});
  };

  /* idle: still editing · working: locked, fetching · done: fetched, but
     something wants looking at before we move on. */
  const state = s => {
    document.body.dataset.state = s;
    $('list').disabled = $('load').disabled = s === 'working';
    $('load').textContent = s === 'working' ? 'Loading…' : 'Load';
  };

  const counted = () => {
    const n = parse($('list').value).length;
    $('count').textContent = n ? `${n} card${n === 1 ? '' : 's'}` : '';
  };

  async function load(){
    const names = parse($('list').value);
    if (!names.length){ $('list').focus(); return; }
    /* show the list back as it was understood, quantities and set hints gone */
    $('list').value = names.join('\n');
    localStorage.setItem(SAVED, $('list').value);

    $('report').innerHTML = '';
    $('phase').textContent = '';
    $('bar').style.width = '0%';
    state('working');

    let clean = true;
    try {
      data = await build(names, {
        onProgress: (done, label) => {
          $('bar').style.width = (done * 100).toFixed(1) + '%';
          $('phase').textContent = label;
        },
        onReport: rows => {
          $('report').innerHTML = view.report(rows);
          clean = rows.every(r => r.status === 'ok');
        },
      });
    } catch (err) {
      console.error(err);
      $('phase').innerHTML = `<span class="bad">${view.esc(err.message)}</span>`;
      state('idle');
      return;
    }

    $('tally').innerHTML = view.tally(data.db.stats);
    $('note').innerHTML = view.missingNote(data.db.missing);
    render();

    /* Nothing to query means nothing to look at, so stay put and say so. */
    if (!data.db.cards.length){
      $('phase').innerHTML = '<span class="bad">None of those names matched a card.</span>';
      state('done');
    } else if (clean){
      state('idle');
      show('gallery');
    } else {
      state('done');
    }
  }

  /* gallery controls, bound once — every load re-renders through the same
     handlers rather than re-wiring them */
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

  $('load').addEventListener('click', load);
  $('go-on').addEventListener('click', () => show('gallery'));
  $('edit').addEventListener('click', () => { state('idle'); show('list'); });
  $('list').addEventListener('input', () => {
    localStorage.setItem(SAVED, $('list').value);
    counted();
  });

  /* Taking up a suggested name rewrites that line, ready to load again. */
  $('report').addEventListener('click', e => {
    const btn = e.target.closest('[data-rename]');
    if (!btn) return;
    const lines = $('list').value.split('\n');
    const i = lines.findIndex(l => l.trim() === btn.dataset.rename);
    if (i >= 0) lines[i] = btn.dataset.to;
    $('list').value = lines.join('\n');
    localStorage.setItem(SAVED, $('list').value);
    counted();
    btn.disabled = true;
    btn.textContent = 'Updated';
  });

  $('list').value = localStorage.getItem(SAVED) ?? SAMPLE;
  counted();
  state('idle');
  show('list');
}
