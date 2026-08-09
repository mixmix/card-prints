/* CubeCobra client — just enough to turn a cube link into a list of names.
   Knows nothing about Scryfall or about how the gallery wants its data.

   Deliberately not routed through scryfall.js's request queue: that queue
   exists to honour Scryfall's rate limits, and putting a different host in it
   would stall card lookups behind a cube fetch for no reason.

   CORS: /cube/api/cubelist answers with `Access-Control-Allow-Origin: *`, so
   the browser can call it directly. index.html's CSP has to list the host. */

const HOSTS = new Set(['cubecobra.com', 'www.cubecobra.com']);
const API = 'https://cubecobra.com/cube/api/';

/* The id is everything CubeCobra needs and everything we are willing to put in
   a URL path. Both the short id ("peach_peasant") and the 24-character
   database id ("5d3f7245d1bbf667dd9d4286") are live ids, so both are accepted
   as they are. Case is preserved — short ids are not documented as
   case-insensitive, so folding could invent a 404. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/* Accepts a bare id, a full cube URL, or anything in between: any of the cube
   sub-pages (list, overview, playtest…), with or without a scheme, host,
   trailing slash, query or hash. */
export function identify(input){
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Give a CubeCobra cube id or link.');

  let id = raw;
  if (raw.includes('/')){
    const absolute = /^https?:\/\//i.test(raw) ? raw
      : raw.startsWith('//') ? 'https:' + raw
      : /^(www\.)?cubecobra\.com\//i.test(raw) ? 'https://' + raw
      : 'https://cubecobra.com/' + raw.replace(/^\/+/, '');

    let url;
    try { url = new URL(absolute); }
    catch { throw new Error(`“${raw}” is not a cube id or a CubeCobra link.`); }
    /* Saying so plainly beats letting it 404 as a missing cube. */
    if (!HOSTS.has(url.hostname.toLowerCase()))
      throw new Error(`${url.hostname} is not CubeCobra — paste a cubecobra.com link or a cube id.`);

    const seg = url.pathname.split('/').filter(Boolean);
    id = seg[0] === 'cube' ? (seg[2] ?? seg[1]) : seg.at(-1);
    try { id = decodeURIComponent(id ?? ''); } catch { /* keep it raw */ }
  }

  if (!ID.test(id)) throw new Error(`“${raw}” is not a cube id or a CubeCobra link.`);
  return id;
}

export const pageUrl = id => `https://cubecobra.com/cube/list/${encodeURIComponent(id)}`;

/* The card names, one a line — about 8KB for a 500-card cube, against 1.26MB
   for the same cube through /cube/api/cubeJSON. Returned as raw text so the
   caller can run it through data.js's own parse(). */
export async function list(id){
  let res;
  try {
    res = await fetch(API + 'cubelist/' + encodeURIComponent(id));
  } catch (err) {
    /* A 404 from CubeCobra carries no CORS header, so the browser rejects
       before any status is readable — a wrong id and an unreachable site are
       genuinely indistinguishable from here, and so is a CSP violation. The
       raw error goes to the console, where the browser's own explanation (if
       any) will be sitting next to it. */
    console.error('CubeCobra fetch failed:', err);
    throw new Error(
      `Could not load cube “${id}” — there may be no cube with that id, ` +
      `or CubeCobra may be unreachable.`);
  }
  if (!res.ok) throw new Error(`CubeCobra: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text.trim()) throw new Error(`Cube “${id}” has no cards in it.`);
  return text;
}

/* The cube's display name, which the plain list does not carry.

   It lives in /cube/api/cubeJSON, whose card array makes it a 1.26MB document
   — but `cards` is the last key, and everything before it is about 2KB. The
   endpoint ignores Range (it answers 200 with the whole body), so instead we
   read the stream until the cards begin, close the prefix into valid JSON, and
   cancel. That costs tens of kilobytes rather than hundreds.

   Cosmetic, so it never throws: a null just means the caller falls back to
   showing the id. */
const MARK = ',"cards":';
const CAP = 256 * 1024;

export async function title(id){
  try {
    const res = await fetch(API + 'cubeJSON/' + encodeURIComponent(id));
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    /* Streaming mode matters: a chunk boundary can fall inside a multi-byte
       character, and cube names are full of accents. */
    const decoder = new TextDecoder();
    let text = '', read = 0, cut = -1;
    try {
      while (cut === -1 && read < CAP){
        const {done, value} = await reader.read();
        if (done) break;
        read += value.length;
        text += decoder.decode(value, {stream: true});
        cut = text.indexOf(MARK);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (cut === -1) return null;

    /* A cube description containing that exact sequence would break the parse.
       Harmless — we fall back to the id. */
    const name = JSON.parse(text.slice(0, cut) + '}').name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/* One cube, ready to drop into a textarea. The list comes first so that a bad
   id fails in exactly one place, before the expensive stream. */
export async function cube(input){
  const id = identify(input);
  const text = await list(id);
  return {id, text, title: await title(id) || id, url: pageUrl(id)};
}
