const fs = require('fs');
let s = fs.readFileSync('index.html', 'utf8');
const pos = [
  'left:130px; top:140px;',
  'left:520px; top:140px;',
  'left:910px; top:140px;',
];
let i = 0;
s = s.replace(/<div class="mini">(<div class="m-tab"><\/div><div class="m-back"><\/div><div class="m-front"><\/div>)<\/div>/g, (m, inner) => {
  const at = pos[i++] || '';
  return `<div class="mini" style="${at}">${inner}</div>`;
});
if (i !== 3) { console.error('replaced', i); process.exit(1); }
fs.writeFileSync('index.html', s);
console.log('ok', i);
