const fs = require('fs');
let s = fs.readFileSync('index.html', 'utf8');
const old = `      <div class="x-body">
        <div class="mini"><div class="m-tab"></div><div class="m-back"></div><div class="m-front"></div></div>
        <div class="mini"><div class="m-tab"></div><div class="m-back"></div><div class="m-front"></div></div>
        <div class="mini"><div class="m-tab"></div><div class="m-back"></div><div class="m-front"></div></div>
      </div>`;
const next = `      <div class="x-body">
        <div class="mini" style="left:130px; top:140px;"><div class="m-tab"></div><div class="m-back"></div><div class="m-front"></div></div>
        <div class="mini" style="left:520px; top:140px;"><div class="m-tab"></div><div class="m-back"></div><div class="m-front"></div></div>
        <div class="mini" style="left:910px; top:140px;"><div class="m-tab"></div><div class="m-back"></div><div class="m-front"></div></div>
      </div>`;
if (!s.includes(old)) { console.error('MISS x-body'); process.exit(1); }
s = s.split(old).join(next);
fs.writeFileSync('index.html', s);
console.log('ok');
