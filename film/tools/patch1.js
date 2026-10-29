const fs = require('fs');
let s = fs.readFileSync('index.html', 'utf8');
const rep = (a, b) => {
  if (!s.includes(a)) { console.error('MISS:', a.slice(0, 70)); process.exitCode = 1; return; }
  s = s.split(a).join(b);
};
rep('.slider .thumb {', '#dress-slider { position: absolute; }\n  .slider .thumb {');
rep(".fromTo('.kicker', { autoAlpha: 0, x: -30 }, { autoAlpha: 1, x: 0, duration: .5 }, 2.0)", ".fromTo('.kicker', { autoAlpha: 0, x: -30 }, { autoAlpha: 1, x: 0, duration: .5 }, 0.9)");
rep(".to('#dress-title .ch', { yPercent: 0, duration: .8, stagger: .05, ease: 'expo.out' }, 2.55);", ".to('#dress-title .ch', { yPercent: 0, duration: .8, stagger: .05, ease: 'expo.out' }, 1.3);");
rep('{ autoAlpha: 1, y: 0, duration: .6 }, 4.2)', '{ autoAlpha: 1, y: 0, duration: .6 }, 3.4)');
rep('id="app-folder" data-om-id="folder-app" style="left:1000px; top:330px; scale:.72;"', 'id="app-folder" data-om-id="folder-app" style="left:915px; top:318px; scale:.52;"');
rep(".fromTo('#app-folder', { autoAlpha: 0, scale: .5, y: 60 }, { autoAlpha: 1, scale: .72, y: 0", ".fromTo('#app-folder', { autoAlpha: 0, scale: .4, y: 60 }, { autoAlpha: 1, scale: .52, y: 0");
rep('<div class="folder" id="packs-badge" style="left:120px; top:100px; scale:.34;">', '<div class="folder" id="packs-badge" data-remove style="left:120px; top:100px; scale:.34;">');
rep('<div class="caption" data-om-id="pack-caption1" data-var-text="packCaption1" style="left:430px; top:150px;"></div>', '<div class="caption" data-om-id="pack-caption1" data-var-text="packCaption1" style="left:0; right:0; top:96px; text-align:center; font-size:56px;"></div>');
rep('style="left:680px; top:270px; scale:0;"', 'style="left:770px; top:290px; scale:0;"');
rep('<div class="caption" data-om-id="pack-caption2" data-var-text="packCaption2" style="left:680px; top:880px; font-size:52px;"></div>', '<div class="caption" data-om-id="pack-caption2" data-var-text="packCaption2" style="left:0; right:0; top:930px; text-align:center; font-size:52px;"></div>');
rep('const gridX = 150, gridY = 260, gap = 36;', 'const gridX = 170, gridY = 240, gap = 36;');
rep("tile.style.left = gridX + col * (296 + gap + 44) + 'px';", "tile.style.left = gridX + col * 540 + 'px';");
rep("tile.style.top = gridY + row * (300 + gap) + 'px';", "tile.style.top = gridY + row * 286 + 'px';");
rep("    .fromTo('#packs-badge', { autoAlpha: 0, scale: .2 }, { autoAlpha: 1, scale: .34, duration: .5, ease: 'back.out(1.8)' }, 13.5)\n", "");
rep('.explorer .x-body { position: relative; padding: 46px 60px; display: flex; gap: 72px; justify-content: center; }', '.explorer .x-body { position: relative; height: 780px; }');
rep('.mini { position: relative; width: 210px; height: 190px; opacity: .55; }', '.mini { position: absolute; width: 280px; height: 260px; opacity: .55; }');
rep('.mini .m-front { position: absolute; left: 0; right: 0; top: 62px; bottom: 0;', '.mini .m-front { position: absolute; left: 0; right: 0; top: 80px; bottom: 0;');
rep('id="apply-folder" data-om-id="folder-apply" style="left:330px; top:330px; scale:.52; z-index:5;"', 'id="apply-folder" data-om-id="folder-apply" style="left:1300px; top:352px; scale:.45; z-index:5;"');
rep(".fromTo('[data-om-id=\"pack-caption2\"]', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: .6 }, 18.3);", ".fromTo('[data-om-id=\"pack-caption2\"]', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: .6 }, 18.3)\n    .to('#pack-cover-folder', { autoAlpha: 0, duration: .3, ease: 'power2.in' }, 19.45);");
fs.writeFileSync('index.html', s);
console.log(process.exitCode ? 'had misses' : 'patched ok');
