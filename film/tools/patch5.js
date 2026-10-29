const fs = require('fs');
let s = fs.readFileSync('index.html', 'utf8');
const a = "tl.fromTo('#s-dress', { scale: 1 }, { scale: 1.04, duration: 3.4, ease: 'none' }, 0.3)";
if (!s.includes(a)) { console.error('MISS'); process.exit(1); }
const slam = "tl.fromTo('#dress-folder', { scale: 1.3, autoAlpha: 0, y: -90 }, { scale: 1, autoAlpha: 1, y: 0, duration: .55, ease: 'back.out(1.4)' }, 0.06)\n    " + a;
s = s.split(a).join(slam);
fs.writeFileSync('index.html', s);
console.log('ok');
