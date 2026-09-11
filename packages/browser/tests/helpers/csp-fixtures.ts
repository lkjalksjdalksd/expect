import * as http from "node:http";
import { AXE_PAGE_SCRIPT_PATH } from "../../src/utils/axe-page-script-request";

export const CSP_NONCE = "expect-csp-test-nonce";

export const contentSecurityPolicy = (scriptSrc: string) =>
  `default-src 'self'; script-src ${scriptSrc}; object-src 'none'; base-uri 'self'`;

export const CSP_SELF_NONCE = contentSecurityPolicy(`'self' 'nonce-${CSP_NONCE}'`);
export const CSP_NONCE_ONLY = contentSecurityPolicy(`'nonce-${CSP_NONCE}'`);
export const CSP_NONCE_STRICT_DYNAMIC = contentSecurityPolicy(
  `'nonce-${CSP_NONCE}' 'strict-dynamic'`,
);
export const CSP_SELF_ONLY = contentSecurityPolicy("'self'");

export const CSP_VIOLATIONS_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>CSP audit violations</title>
    <script nonce="${CSP_NONCE}"></script>
  </head>
  <body>
    <main>
      <h1>CSP audit violations</h1>
      <img src="missing-alt.png">
    </main>
  </body>
</html>`;

export const CSP_SELF_ONLY_VIOLATIONS_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>CSP audit violations</title>
  </head>
  <body>
    <main>
      <h1>CSP audit violations</h1>
      <img src="missing-alt.png">
    </main>
  </body>
</html>`;

export const CSP_CLEAN_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CSP audit clean</title>
    <script nonce="${CSP_NONCE}"></script>
  </head>
  <body>
    <main>
      <h1>CSP audit clean</h1>
      <p>Accessible paragraph with enough contrast against the default background.</p>
      <img src="ok.png" width="16" height="16" alt="Placeholder photograph of a landscape">
      <button type="button">Continue</button>
    </main>
  </body>
</html>`;

export const AXE_BLOCKING_SERVICE_WORKER = `self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname === "${AXE_PAGE_SCRIPT_PATH}") {
    event.respondWith(new Response("blocked", { status: 404 }));
  }
});
`;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const startCspFixtureServer = async () => {
  const server = http.createServer((request, response) => {
    const requestPath = (request.url ?? "/").split("?")[0] ?? "/";
    if (requestPath === "/ok.png" || requestPath === "/missing-alt.png") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(PNG_1X1);
      return;
    }
    if (requestPath === "/sw.js") {
      response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      response.end(AXE_BLOCKING_SERVICE_WORKER);
      return;
    }

    let csp = CSP_SELF_NONCE;
    let html = CSP_VIOLATIONS_HTML;
    if (requestPath.startsWith("/nonce-only")) {
      csp = CSP_NONCE_ONLY;
      html = requestPath.includes("clean") ? CSP_CLEAN_HTML : CSP_VIOLATIONS_HTML;
    } else if (requestPath.startsWith("/strict-dynamic")) {
      csp = CSP_NONCE_STRICT_DYNAMIC;
      html = requestPath.includes("clean") ? CSP_CLEAN_HTML : CSP_VIOLATIONS_HTML;
    } else if (requestPath.startsWith("/self-only")) {
      csp = CSP_SELF_ONLY;
      html = CSP_SELF_ONLY_VIOLATIONS_HTML;
    } else if (requestPath.startsWith("/clean")) {
      html = CSP_CLEAN_HTML;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
    });
    response.end(html);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("csp fixture server has no port");
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
};
