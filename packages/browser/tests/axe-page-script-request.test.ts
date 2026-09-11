import { describe, expect, it } from "vite-plus/test";
import { AXE_PAGE_SCRIPT_PATH, isAxePageScriptRequest } from "../src/utils/axe-page-script-request";

describe("isAxePageScriptRequest", () => {
  it("matches only the audited page origin and axe script path", () => {
    const pageOrigin = "http://127.0.0.1:4377";
    expect(
      isAxePageScriptRequest(pageOrigin, new URL(`${pageOrigin}${AXE_PAGE_SCRIPT_PATH}`)),
    ).toBe(true);
    expect(
      isAxePageScriptRequest(pageOrigin, new URL(`http://127.0.0.1:4378${AXE_PAGE_SCRIPT_PATH}`)),
    ).toBe(false);
    expect(isAxePageScriptRequest(pageOrigin, new URL(`${pageOrigin}/other.js`))).toBe(false);
  });
});
