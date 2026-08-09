/* Scryfall API client — rate limiting, 429 handling, and the batch endpoints.
   Knows nothing about how the gallery wants its data shaped.

   CORS: api.scryfall.com and the *.scryfall.io asset origins answer with
   `Access-Control-Allow-Origin: *` for GET, HEAD, POST and OPTIONS, and the
   preflight for our JSON POST allows Content-Type, so the browser can talk to
   them directly and no proxy is needed. index.html carries the matching CSP.

   User-Agent: Scryfall asks scripts to identify themselves, but says on-page
   browser JavaScript should leave the browser's own User-Agent intact — which
   is just as well, since fetch() refuses to set it. Accept is also required,
   and that one we do send. */

const API = 'https://api.scryfall.com';

/* Scryfall's hard limits: /cards/search, /cards/named and /cards/collection
   allow 2 requests a second; everything else allows 10. */
const CARD_GAP = 550, OTHER_GAP = 120;
/* "Recieving an HTTP 429 response will result in your access being limited for
   30 seconds." Retry-After is not exposed to cross-origin script, so we take
   the documented 30s as read. */
const BACKOFF_429 = 30_000;
const TRIES = 4;

/* /cards/collection accepts 75 identifiers. Search queries are truncated past
   roughly a kilobyte and an `oracleid:` clause costs 46 characters of it, so
   15 cards a search leaves plenty of headroom. */
export const NAMES_PER_LOOKUP = 75;
export const CARDS_PER_SEARCH = 15;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Every call is threaded through one promise chain, so concurrency cannot
   exceed the published rate however many callers are in flight. `penalty`
   widens the gap for the rest of the session once we have been warned:
   Scryfall blocks applications that keep overloading it after a 429. */
let chain = Promise.resolve(), last = 0, penalty = 0;

function queued(gap, fn){
  const run = chain.then(async () => {
    const wait = last + gap + penalty - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return fn();
  });
  chain = run.then(() => {}, () => {});
  return run;
}

async function request(path, {gap = CARD_GAP, ...init} = {}){
  return queued(gap, async () => {
    for (let attempt = 1; ; attempt++){
      const res = await fetch(path.startsWith('http') ? path : API + path, {
        ...init, headers: {Accept: 'application/json', ...init.headers},
      });
      /* Backing off is not optional — ignoring a 429 is how an application
         earns a ban rather than a warning. */
      if (res.status === 429){
        if (attempt === TRIES) throw new Error(
          'Scryfall is rate limiting this browser. Give it a minute and try again.');
        penalty = Math.min(penalty + 250, 2000);
        await sleep(BACKOFF_429);
        last = Date.now();
        continue;
      }
      if (res.status >= 500 && attempt < TRIES){
        await sleep(400 * 2 ** attempt);
        continue;
      }
      return res;
    }
  });
}

/* Scryfall reports "no such card" as a 404 carrying an error object, which is
   an answer rather than a failure; only a genuinely broken response throws. */
async function json(path, init){
  const res = await request(path, init);
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`Scryfall: ${res.status} ${res.statusText}`);
  return body;
}

/* Exact lookup of up to 75 names at once — case and surrounding whitespace do
   not matter, and either face of a double-faced card will match. Scryfall
   echoes the identifiers it could not place back in `not_found`. */
export async function collection(names){
  const body = await json('/cards/collection', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({identifiers: names.map(name => ({name}))}),
  });
  if (body.object === 'error') throw new Error(body.details);
  const missed = new Set((body.not_found || []).map(id => id.name));
  return {found: body.data || [], missed: names.filter(n => missed.has(n))};
}

/* Last resort for a name nothing matched exactly. Scryfall's fuzzy match is
   what turns an alternate printed name — "Drix Interception" — into the card
   its database files under "Amazing Acrobatics". Null when nothing matched, or
   when the name was too ambiguous to call. */
export async function named(fuzzy){
  const body = await json('/cards/named?' + new URLSearchParams({fuzzy}));
  return body.object === 'card' ? body : null;
}

/* Every English paper printing of the given cards, oldest first. Searching by
   oracle id rather than by name keeps the batching exact: `!"Lightning Bolt"`
   would also drag in "Emeritus of Conflict // Lightning Bolt". */
export async function printings(oracleIds){
  let url = '/cards/search?' + new URLSearchParams({
    q: `game:paper lang:en (${oracleIds.map(id => `oracleid:${id}`).join(' or ')})`,
    unique: 'prints', order: 'released', dir: 'asc',
  });
  const out = [];
  while (url){
    const body = await json(url);
    if (body.object === 'error'){
      if (body.status === 404) break;   // nothing in this batch exists on paper
      throw new Error(body.details);
    }
    out.push(...body.data);
    url = body.has_more ? body.next_page : null;
  }
  return out;
}

/* One request covers every set there has ever been. */
export async function sets(){
  const body = await json('/sets', {gap: OTHER_GAP});
  const out = {};
  for (const s of body.data) out[s.code.toUpperCase()] = {name: s.name, icon: s.icon_svg_uri};
  return out;
}
