const fs = require('fs');
let s = fs.readFileSync('index.html', 'utf8');
const rep = (a, b) => {
  if (!s.includes(a)) { console.error('MISS:', a.slice(0, 70)); process.exitCode = 1; return; }
  s = s.split(a).join(b);
};
const NL = s.includes('\r\n') ? '\r\n' : '\n';
const add = (anchor, insert) => rep(anchor, anchor + NL + insert);

add("tl.addLabel('scene:dress', 0);",
  "  tl.fromTo('#s-dress', { scale: 1 }, { scale: 1.05, duration: 6.0, ease: 'none' }, 0.3)" + NL +
  "    .to('#dress-folder', { rotation: 1.6, duration: 1.9, ease: 'sine.inOut', yoyo: true, repeat: 3 }, 2.4);");
add("OM.sfx('whoosh', 6.15);",
  "  tl.fromTo('#s-app', { scale: 1.03 }, { scale: 1, duration: 7.0, ease: 'none' }, 6.4)" + NL +
  "    .to('#app-folder', { rotation: -1.4, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: 2 }, 8.0);");
add("OM.sfx('glitch', 13.35);",
  "  tl.fromTo('#s-packs', { scale: 1.04 }, { scale: 1, duration: 6.2, ease: 'none' }, 13.5);" + NL +
  "  document.querySelectorAll('#pack-grid .tile').forEach((tile, i) => {" + NL +
  "    tl.to(tile, { y: '-=6', duration: 1.1, ease: 'sine.inOut', yoyo: true, repeat: 2 }, 16.4 + i * 0.06);" + NL +
  "  });");
add("OM.sfx('thud', 19.55);",
  "  tl.fromTo('#s-apply', { scale: 1.04 }, { scale: 1, duration: 6.4, ease: 'none' }, 19.7)" + NL +
  "    .to('#explorer', { y: '-=8', duration: 1.6, ease: 'sine.inOut', yoyo: true, repeat: 2 }, 20.8);");
add(".fromTo('#cta-line2', { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: .5 }, 27.6)",
  "    .to('#cta-folder', { y: '-=10', duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 27.0)");
fs.writeFileSync('index.html', s);
console.log(process.exitCode ? 'had misses' : 'patched ok');
