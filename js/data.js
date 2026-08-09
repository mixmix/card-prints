/* Data source layer — everything that knows where the JSON lives. */

const DATA = new URL('../data/', import.meta.url);

async function json(file){
  const res = await fetch(new URL(file, DATA));
  if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
  return res.json();
}

/* Images arrive either as remote URLs or as inlined base64 webp; inlined data
   is decoded once into object URLs so re-renders stay cheap. */
function toSources(raw){
  const src = {};
  for (const [id, value] of Object.entries(raw)){
    if (/^(https?:|data:|\.|\/)/.test(value)){
      src[id] = value;
    } else {
      const bin = atob(value), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      src[id] = URL.createObjectURL(new Blob([buf], {type:'image/webp'}));
    }
  }
  return src;
}

export async function load(){
  const [db, images] = await Promise.all([json('cards.json'), json('images.json')]);
  return {db, src: toSources(images)};
}
