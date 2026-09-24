import { readFileSync, writeFileSync } from 'node:fs';

const p = new URL('../app.js', import.meta.url);
let s = readFileSync(p, 'utf8');

/* 1 ── card <img>: eager + high fetchpriority for the first 3 visible;
   rewrite the single shared template line that produces every card img.  */
const oldImg = '<img src="${imgSrc(img)}" alt="${escapeAttr(pretty)}" loading="lazy">';
const newImg = '<img src="${imgSrc(img)}" alt="${escapeAttr(pretty)}" loading="${i < 3 ? \'eager\' : \'lazy\'}" fetchpriority="${i < 3 ? \'high\' : \'auto\'}" decoding="async">';
if (s.includes(oldImg)) {
  s = s.replace(oldImg, newImg, 1);
}

/* 2 ── after the click wiring, preconnect + preload the first 3 visible.
   We anchor right before the delete-button wiring block which always
   follows renderGallery's builder. */
const anchor = "  gallery.querySelectorAll('.card-delete').forEach(btn => {";
if (s.includes(anchor)) {
  const hint = `/* First paint cost: raw.githubusercontent.com handshakes weren't
   warmed and the first-visible photos had to wait for the discovery fetch.
   Now we preconnect during render and start the first three eagerly. */
  const pc = document.createElement('link');
  pc.rel = 'preconnect';
  pc.href = 'https://raw.githubusercontent.com';
  pc.crossOrigin = 'anonymous';
  document.head.appendChild(pc);

  const firstFolder = (state.order || [])[0];
  const firstImgs = firstFolder ? (state.folders[firstFolder] || []).slice(0, 3) : [];
  firstImgs.forEach(img => {
    const pre = document.createElement('link');
    pre.rel = 'preload';
    pre.as = 'image';
    pre.href = imgSrc(img);
    pre.fetchPriority = 'high';
    document.head.appendChild(pre);
  });

`;
  s = s.replace(anchor, hint + anchor, 1);
}

writeFileSync(p, s, 'utf8');
console.log('perf patch applied:', s.includes('fetchpriority="'), s.includes(newImg));
