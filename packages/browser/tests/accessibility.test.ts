import * as http from "node:http";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { chromium, webkit } from "playwright";
import type { Browser as PlaywrightBrowser, Page } from "playwright";
import {
  presentAccessibilityAudit,
  runAccessibilityAudit,
  type AccessibilityAuditResult,
} from "../src/accessibility";
import { AGENT_OVERLAY_CONTAINER_ID } from "../src/constants";
import { startCspFixtureServer } from "./helpers/csp-fixtures";

const runAudit = (page: Page) => Effect.runPromise(runAccessibilityAudit(page));

const emptyEngine = {
  status: "completed" as const,
  violations: [],
  incomplete: [],
};

const emptySummary = {
  total: 0,
  critical: 0,
  serious: 0,
  moderate: 0,
  minor: 0,
  incomplete: 0,
};

const failedAxeEmptyIbm: AccessibilityAuditResult = {
  engines: {
    axe: {
      status: "failed",
      cause: "ReferenceError: t is not defined",
      violations: [],
      incomplete: [],
    },
    ibm: emptyEngine,
  },
  violations: [],
  incomplete: [],
  summary: emptySummary,
};

const failedIbmEmptyAxe: AccessibilityAuditResult = {
  engines: {
    axe: emptyEngine,
    ibm: {
      status: "failed",
      cause: "IBM inject failed",
      violations: [],
      incomplete: [],
    },
  },
  violations: [],
  incomplete: [],
  summary: emptySummary,
};

const emptyCompleted: AccessibilityAuditResult = {
  engines: {
    axe: emptyEngine,
    ibm: emptyEngine,
  },
  violations: [],
  incomplete: [],
  summary: emptySummary,
};

const PRODUCT_AND_OVERLAY_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><title>Audit fixture</title></head>
  <body>
    <main>
      <h1>Audit fixture</h1>
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

const INCOMPLETE_CONTRAST_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><title>Incomplete fixture</title></head>
  <body>
    <main>
      <h1>Incomplete fixture</h1>
      <div style="background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='); padding: 12px;">
        <p style="color: #777777">Contrast against image background</p>
      </div>
    </main>
  </body>
</html>`;

describe("presentAccessibilityAudit", () => {
  it("does not treat a failed axe engine as an empty pass", () => {
    const presented = presentAccessibilityAudit(failedAxeEmptyIbm);
    expect(presented.kind).toBe("report");
    if (presented.kind !== "report") {
      throw new Error("expected report");
    }
    expect(presented.data.engines.axe.status).toBe("failed");
    expect(presented.data.engines.axe.cause).toContain("t is not defined");
  });

  it("does not treat a failed ibm engine as an empty pass", () => {
    const presented = presentAccessibilityAudit(failedIbmEmptyAxe);
    expect(presented.kind).toBe("report");
    if (presented.kind !== "report") {
      throw new Error("expected report");
    }
    expect(presented.data.engines.ibm.status).toBe("failed");
  });

  it("allows empty pass only when both engines completed with no findings", () => {
    const presented = presentAccessibilityAudit(emptyCompleted);
    expect(presented.kind).toBe("empty-pass");
    if (presented.kind !== "empty-pass") {
      throw new Error("expected empty-pass");
    }
    expect(presented.text).toBe("No accessibility violations found.");
  });

  it("preserves incomplete results instead of empty-pass", () => {
    const presented = presentAccessibilityAudit({
      ...emptyCompleted,
      incomplete: [
        {
          ruleId: "color-contrast",
          description: "incomplete contrast",
          nodes: [{ selector: "p", html: "<p>x</p>", failureSummary: "" }],
        },
      ],
      summary: { ...emptySummary, incomplete: 1 },
    });
    expect(presented.kind).toBe("report");
  });
});

const launchEngine = async (browserType: "chromium" | "webkit") => {
  const launcher = browserType === "chromium" ? chromium : webkit;
  try {
    const playwrightBrowser = await launcher.launch({ headless: true });
    const context = await playwrightBrowser.newContext();
    const page = await context.newPage();
    return { playwrightBrowser, page };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${browserType} executable missing: ${message}`);
  }
};

describe("runAccessibilityAudit", () => {
  let chromiumBrowser: PlaywrightBrowser | undefined;
  let chromiumPage: Page;

  beforeAll(async () => {
    const session = await launchEngine("chromium");
    chromiumBrowser = session.playwrightBrowser;
    chromiumPage = session.page;
  });

  afterAll(async () => {
    if (chromiumBrowser) {
      await chromiumBrowser.close();
    }
  });

  it("completes axe on chromium and reports the product image-alt violation", async () => {
    await chromiumPage.setContent(PRODUCT_AND_OVERLAY_HTML);
    const result = await runAudit(chromiumPage);
    expect(result.engines.axe.status).toBe("completed");
    expect(result.engines.axe.cause).toBeUndefined();
    expect(result.violations.some((violation) => violation.ruleId === "image-alt")).toBe(true);
  });

  it("excludes owned Expect overlay hosts without substring-suppressing product findings", async () => {
    await chromiumPage.setContent(PRODUCT_AND_OVERLAY_HTML);
    const result = await runAudit(chromiumPage);
    const overlayOwned = result.violations.filter((violation) =>
      violation.nodes.some(
        (node) =>
          node.selector === `#${AGENT_OVERLAY_CONTAINER_ID}` ||
          node.html.includes('id="overlay-unlabelled-svg"'),
      ),
    );
    expect(overlayOwned).toEqual([]);
    const productImage = result.violations.find((violation) => violation.ruleId === "image-alt");
    expect(productImage).toBeDefined();
    expect(
      productImage?.nodes.some((node) =>
        node.html.includes(`data-doc="${AGENT_OVERLAY_CONTAINER_ID}"`),
      ),
    ).toBe(true);
    expect(result.engines.ibm.status).toBe("completed");
    expect(
      result.violations.some(
        (violation) =>
          violation.ruleId === "svg_graphics_labelled" &&
          violation.nodes.some(
            (node) =>
              node.selector.includes("product-unlabelled-svg") ||
              node.html.includes("product-unlabelled-svg"),
          ),
      ),
    ).toBe(true);
  });

  it("preserves live axe incomplete rows", async () => {
    await chromiumPage.setContent(INCOMPLETE_CONTRAST_HTML);
    const result = await runAudit(chromiumPage);
    expect(result.engines.axe.status).toBe("completed");
    expect(result.incomplete.some((item) => item.ruleId === "color-contrast")).toBe(true);
  });

  it("reports axe engine failure instead of empty pass when script injection throws", async () => {
    await chromiumPage.setContent("<html><body><h1>ok</h1></body></html>");
    const originalAddScriptTag = chromiumPage.addScriptTag.bind(chromiumPage);
    chromiumPage.addScriptTag = async () => {
      throw new Error("forced axe inject failure");
    };
    try {
      const result = await runAudit(chromiumPage);
      expect(result.engines.axe.status).toBe("failed");
      expect(result.engines.axe.cause).toContain("forced axe inject failure");
      expect(presentAccessibilityAudit(result).kind).toBe("report");
    } finally {
      chromiumPage.addScriptTag = originalAddScriptTag;
    }
  });
});

describe("runAccessibilityAudit webkit", () => {
  it("completes axe on webkit for the same product fixture", async () => {
    const session = await launchEngine("webkit");
    try {
      await session.page.setContent(PRODUCT_AND_OVERLAY_HTML);
      const result = await runAudit(session.page);
      expect(result.engines.axe.status).toBe("completed");
      expect(result.violations.some((violation) => violation.ruleId === "image-alt")).toBe(true);
      expect(
        result.violations.some((violation) =>
          violation.nodes.some((node) => node.html.includes('id="overlay-unlabelled-svg"')),
        ),
      ).toBe(false);
    } finally {
      await session.playwrightBrowser.close();
    }
  });
});

describe("runAccessibilityAudit restrictive nonce CSP", () => {
  let cspServer: http.Server;
  let cspOrigin: string;

  beforeAll(async () => {
    const fixture = await startCspFixtureServer();
    cspServer = fixture.server;
    cspOrigin = fixture.origin;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      cspServer.close(() => resolve());
    });
  });

  const auditCspPage = async (browserType: "chromium" | "webkit", fixturePath: string) => {
    const session = await launchEngine(browserType);
    try {
      await session.page.goto(`${cspOrigin}${fixturePath}`, { waitUntil: "domcontentloaded" });
      return await runAudit(session.page);
    } finally {
      await session.playwrightBrowser.close();
    }
  };

  const expectViolationReport = (result: AccessibilityAuditResult) => {
    expect(result.engines.axe.status).toBe("completed");
    expect(result.engines.axe.cause).toBeUndefined();
    expect(result.engines.ibm.status).toBe("completed");
    expect(result.engines.ibm.cause).toBeUndefined();
    expect(result.violations.some((violation) => violation.ruleId === "image-alt")).toBe(true);
    expect(presentAccessibilityAudit(result).kind).toBe("report");
  };

  const expectEmptyPass = (result: AccessibilityAuditResult) => {
    expect(result.engines.axe.status).toBe("completed");
    expect(result.engines.ibm.status).toBe("completed");
    expect(result.violations).toEqual([]);
    expect(result.incomplete).toEqual([]);
    expect(presentAccessibilityAudit(result).kind).toBe("empty-pass");
  };

  it("completes axe and ibm on chromium and reports image-alt under script-src self+nonce", async () => {
    expectViolationReport(await auditCspPage("chromium", "/violations"));
  });

  it("completes axe and ibm on webkit and reports image-alt under script-src self+nonce", async () => {
    expectViolationReport(await auditCspPage("webkit", "/violations"));
  });

  it("completes axe and ibm on chromium under nonce-only script-src without self", async () => {
    expectViolationReport(await auditCspPage("chromium", "/nonce-only/violations"));
  });

  it("completes axe and ibm on webkit under nonce-only script-src without self", async () => {
    expectViolationReport(await auditCspPage("webkit", "/nonce-only/violations"));
  });

  it("completes axe and ibm on chromium under nonce strict-dynamic without self", async () => {
    expectViolationReport(await auditCspPage("chromium", "/strict-dynamic/violations"));
  });

  it("completes axe and ibm on webkit under nonce strict-dynamic without self", async () => {
    expectViolationReport(await auditCspPage("webkit", "/strict-dynamic/violations"));
  });

  it("reports empty-pass on chromium for a clean nonce CSP fixture with zero findings", async () => {
    expectEmptyPass(await auditCspPage("chromium", "/clean"));
  });

  it("reports empty-pass on webkit for a clean nonce CSP fixture with zero findings", async () => {
    expectEmptyPass(await auditCspPage("webkit", "/clean"));
  });

  it("fails closed on chromium when a service worker intercepts the axe script request", async () => {
    const session = await launchEngine("chromium");
    try {
      await session.page.goto(`${cspOrigin}/self-only/violations`, {
        waitUntil: "domcontentloaded",
      });
      await session.page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
              once: true,
            });
          });
        }
      });
      await session.page.reload({ waitUntil: "domcontentloaded" });
      const result = await runAudit(session.page);
      expect(result.engines.axe.status).toBe("failed");
      expect(presentAccessibilityAudit(result).kind).toBe("report");
    } finally {
      await session.playwrightBrowser.close();
    }
  });
});
