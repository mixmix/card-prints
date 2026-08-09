import {load} from './data.js';
import {init} from './ui.js';

try {
  init(await load());
} catch (err) {
  console.error(err);
  document.getElementById('out').innerHTML =
    '<div class="blank">Could not load the card data. Serve this folder over HTTP — ' +
    'opening the file directly from disk will not work.</div>';
}
