// 静态站点服务器（wispbyte Node 运行时）
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.json': 'application/json',
};

const root = __dirname;
const port = Number(process.env.SERVER_PORT || process.env.PORT || 3000);

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath.slice(1)));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
      const ext = path.extname(file).toLowerCase();
      const isHtml = ext === '.html' || ext === '';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': data.length,
        // HTML 不缓存（改了立刻生效），静态资源长缓存
        'Cache-Control': isHtml ? 'no-cache, must-revalidate' : 'public, max-age=604800',
      });
      res.end(data);
    });
  });
}).listen(port, () => console.log('serving on port', port));
