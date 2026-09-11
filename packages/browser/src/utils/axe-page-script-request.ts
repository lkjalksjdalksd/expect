export const AXE_PAGE_SCRIPT_PATH = "/__expect_axe_core__/axe.min.js";

export const isAxePageScriptRequest = (pageOrigin: string, scriptRequestUrl: URL) =>
  scriptRequestUrl.origin === pageOrigin && scriptRequestUrl.pathname === AXE_PAGE_SCRIPT_PATH;
