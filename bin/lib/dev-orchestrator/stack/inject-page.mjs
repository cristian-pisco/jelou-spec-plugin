import { createServer } from 'node:http';

export function renderInjectPage({ cookieName, cookieValue, appUrl, account }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Jelou local auth</title></head>`
    + `<body><div><h2>Authenticating local Jelou…</h2>`
    + `<p>Setting <code>${cookieName}</code> for <b>localhost</b> as <b>${account}</b>.</p>`
    + `<p>If you are not redirected, <a href="${appUrl}">open the app</a>.</p></div>`
    + `<script>\n`
    + `document.cookie = "${cookieName}=" + ${JSON.stringify(cookieValue)} + "; path=/; max-age=604800; SameSite=Lax";\n`
    + `setTimeout(function(){ location.replace(${JSON.stringify(appUrl)}); }, 600);\n`
    + `</script></body></html>`;
}

export function startInjectServer({ port, page, listen = createServer }) {
  const server = listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
  });
  server.listen(port, '127.0.0.1');
  return server;
}
