/* DOM wiring — reads the controls, writes the rendered markup. */

import * as view from './render.js';

const $ = id => document.getElementById(id);

function toggle(id, fn){
  const el = $(id);
  el.addEventListener('click', () => {
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', String(on));
    fn(on);
  });
}

function themeSwitch(){
  const btn = $('t-theme');
  const root = document.documentElement;
  const paint = () => btn.textContent =
    root.dataset.theme === 'dark' ? 'Light theme'
    : root.dataset.theme === 'light' ? 'Dark theme' : 'Switch theme';
  btn.addEventListener('click', () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    paint();
  });
  paint();
}

export function init({db, src}){
  let uniq = true;

  const render = () => {
    const {html, groups} = view.gallery(db.cards, {
      query: $('q').value.trim().toLowerCase(), uniq, src,
    });
    $('out').innerHTML = html;
    $('nav').innerHTML = view.nav(groups);
  };

  $('tally').innerHTML = view.tally(db.stats);
  $('note').innerHTML = view.missingNote(db.missing);

  toggle('t-uniq', on => { uniq = on; document.body.classList.toggle('allprints', !on); render(); });
  toggle('t-detail', on => document.body.classList.toggle('detailed', on));
  toggle('t-wrap', on => document.body.classList.toggle('wrapped', on));
  $('q').addEventListener('input', render);
  $('size').addEventListener('input', e =>
    document.documentElement.style.setProperty('--tile', e.target.value + 'px'));
  themeSwitch();

  render();
}
