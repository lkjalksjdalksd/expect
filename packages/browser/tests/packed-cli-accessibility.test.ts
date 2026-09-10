import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AGENT_OVERLAY_CONTAINER_ID } from "../src/constants";

const PACKED_TEST_TIMEOUT_MS = 180_000;
const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/cli");
const mcpDist = path.join(cliRoot, "dist", "browser-mcp.js");

const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><title>Packed audit fixture</title></head>
  <body>
    <main>
      <h1>Packed audit fixture</h1>
      <img src="missing-alt.png" data-doc="${AGENT_OVERLAY_CONTAINER_ID}">
      <svg id="product-unlabelled-svg" width="24" height="24"></svg>
    </main>
    <script>
      const host = document.createElement("div");
      host.id = "${AGENT_OVERLAY_CONTAINER_ID}";
      host.setAttribute("data-expect-overlay", "true");
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = '<svg id="overlay-unlabelled-svg" width="24" height="24"></svg>';
      document.body.appendChild(host);
    </script>
  </body>
</html>`;

const textContent = (result: { content: Array<{ type: string; text?: string }> }) => {
  const textItem = result.content.find((item) => item.type === "text");
  return textItem?.text ?? "";
};

describe("packed expect-cli accessibility_audit", () => {
  let installDir: string;
  let mcpJs: string;
  let server: http.Server;
  let fixtureUrl: string;

  beforeAll(() => {
    if (!fs.existsSync(mcpDist)) {
      throw new Error(`missing packed CLI dist at ${mcpDist}; build expect-cli first`);
    }
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "expect-axe-pack-"));
    execSync(`npm pack --pack-destination ${packDir}`, {
      cwd: cliRoot,
      stdio: "pipe",
    });
    const tarball = fs.readdirSync(packDir).find((file) => file.endsWith(".tgz"));
    if (!tarball) {
      throw new Error("npm pack produced no tarball");
    }
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), "expect-axe-install-"));
    fs.writeFileSync(
      path.join(installDir, "package.json"),
      JSON.stringify({ name: "expect-axe-isolated", private: true }),
    );
    execSync(`npm install --omit=dev ${path.join(packDir, tarball)}`, {
      cwd: installDir,
      stdio: "pipe",
    });
    mcpJs = path.join(installDir, "node_modules", "expect-cli", "dist", "browser-mcp.js");
    const playwrightCli = path.join(installDir, "node_modules", "playwright", "cli.js");
    execSync(`${process.execPath} ${playwrightCli} install chromium webkit`, {
      cwd: installDir,
      stdio: "pipe",
    });
  }, PACKED_TEST_TIMEOUT_MS);

  beforeAll(async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(FIXTURE_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("fixture server has no port");
    }
    fixtureUrl = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("resolves axe-core from the isolated packed CLI", () => {
    const requireFromMcp = createRequire(mcpJs);
    const axePath = requireFromMcp.resolve("axe-core/axe.min.js");
    expect(fs.existsSync(axePath)).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(path.dirname(axePath), "package.json"), "utf8")).version,
    ).toBe("4.13.0");
  });

  const auditWithPackedCli = async (browserType: "chromium" | "webkit") => {
    const previousNoTelemetry = process.env.NO_TELEMETRY;
    process.env.NO_TELEMETRY = "1";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpJs],
      env: { ...process.env, NO_TELEMETRY: "1" },
    });
    const client = new Client({ name: "packed-axe-test", version: "0.0.1" });
    await client.connect(transport);
    try {
      const openResult = await client.callTool({
        name: "open",
        arguments: { url: fixtureUrl, browser: browserType, cookies: false },
      });
      expect(
        textContent(openResult as { content: Array<{ type: string; text?: string }> }),
      ).toContain("Opened");
      const auditResult = await client.callTool({ name: "accessibility_audit", arguments: {} });
      const body = textContent(auditResult as { content: Array<{ type: string; text?: string }> });
      expect(body).not.toBe("No accessibility violations found.");
      const parsed = JSON.parse(body);
      expect(parsed.engines.axe.status).toBe("completed");
      expect(
        parsed.violations.some((violation: { ruleId: string }) => violation.ruleId === "image-alt"),
      ).toBe(true);
      expect(
        parsed.violations.some((violation: { nodes: Array<{ html: string }> }) =>
          violation.nodes.some((node) => node.html.includes('id="overlay-unlabelled-svg"')),
        ),
      ).toBe(false);
      await client.callTool({ name: "close", arguments: {} });
    } finally {
      await client.close();
      if (previousNoTelemetry === undefined) {
        delete process.env.NO_TELEMETRY;
      } else {
        process.env.NO_TELEMETRY = previousNoTelemetry;
      }
    }
  };

  it(
    "packed CLI chromium accessibility_audit completes and keeps product image-alt",
    async () => {
      await auditWithPackedCli("chromium");
    },
    PACKED_TEST_TIMEOUT_MS,
  );

  it(
    "packed CLI webkit accessibility_audit completes and keeps product image-alt",
    async () => {
      await auditWithPackedCli("webkit");
    },
    PACKED_TEST_TIMEOUT_MS,
  );
});
