const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/model.js', ['model.js', 'text/javascript; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/replacement/', ['replacement/index.html', 'text/html; charset=utf-8']],
  ['/replacement/index.html', ['replacement/index.html', 'text/html; charset=utf-8']],
  ['/replacement/styles.css', ['replacement/styles.css', 'text/css; charset=utf-8']],
  ['/replacement/app.js', ['replacement/app.js', 'text/javascript; charset=utf-8']],
  ['/replacement/model.js', ['replacement/model.js', 'text/javascript; charset=utf-8']]
]);

const port = Number(process.env.MEDICATION_DIARY_PORT) || 8765;
http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = files.get(pathname);
  if (!file) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(__dirname, file[0])).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`用藥小記：http://localhost:${port}`));
