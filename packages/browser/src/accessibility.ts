import * as fs from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import { Effect, Schema } from "effect";
import { AGENT_OVERLAY_CONTAINER_ID, OVERLAY_CONTAINER_ID } from "./constants";

export class AccessibilityAuditError extends Schema.ErrorClass<AccessibilityAuditError>(
  "AccessibilityAuditError",
)({
  _tag: Schema.tag("AccessibilityAuditError"),
  engine: Schema.String,
  cause: Schema.String,
}) {
  message = `Accessibility audit failed (${this.engine}): ${this.cause}`;
}

interface AccessibilityNode {
  readonly selector: string;
  readonly html: string;
  readonly failureSummary: string;
}

interface AccessibilityViolation {
  readonly impact: "critical" | "serious" | "moderate" | "minor";
  readonly ruleId: string;
  readonly description: string;
  readonly helpUrl: string;
  readonly wcagTags: readonly string[];
  readonly nodes: readonly AccessibilityNode[];
}

interface AccessibilityIncomplete {
  readonly ruleId: string;
  readonly description: string;
  readonly nodes: readonly AccessibilityNode[];
}

interface AccessibilityAuditOptions {
  readonly selector?: string;
  readonly tags?: readonly string[];
}

interface IbmIssue {
  readonly ruleId: string;
  readonly value: readonly [string, string];
  readonly message: string;
  readonly path: { readonly dom: string } | undefined;
  readonly snippet: string | undefined;
}

interface IbmReport {
  readonly results: readonly IbmIssue[];
}

interface AxeNode {
  readonly target: readonly string[];
  readonly html: string;
  readonly failureSummary?: string;
}

interface AxeRuleResult {
  readonly id: string;
  readonly impact?: string;
  readonly description: string;
  readonly helpUrl: string;
  readonly tags: readonly string[];
  readonly nodes: readonly AxeNode[];
}

interface AxeRunResult {
  readonly violations: readonly AxeRuleResult[];
  readonly incomplete: readonly AxeRuleResult[];
}

export interface AccessibilityEngineResult {
  readonly status: "completed" | "failed";
  readonly cause?: string;
  readonly violations: readonly AccessibilityViolation[];
  readonly incomplete: readonly AccessibilityIncomplete[];
}

export interface AccessibilityAuditResult {
  readonly engines: {
    readonly axe: AccessibilityEngineResult;
    readonly ibm: AccessibilityEngineResult;
  };
  readonly violations: readonly AccessibilityViolation[];
  readonly incomplete: readonly AccessibilityIncomplete[];
  readonly summary: {
    readonly total: number;
    readonly critical: number;
    readonly serious: number;
    readonly moderate: number;
    readonly minor: number;
    readonly incomplete: number;
  };
}

export interface AccessibilityEmptyPass {
  readonly kind: "empty-pass";
  readonly text: string;
}

export interface AccessibilityAuditReport {
  readonly kind: "report";
  readonly data: AccessibilityAuditResult;
}

export type AccessibilityAuditPresentation = AccessibilityEmptyPass | AccessibilityAuditReport;

const DEFAULT_WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const IMPACT_ORDER: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

const IBM_SEVERITY_TO_IMPACT: Record<string, AccessibilityViolation["impact"]> = {
  VIOLATION: "serious",
  RECOMMENDATION: "moderate",
  INFORMATION: "minor",
};

const EXPECT_OVERLAY_HOST_SELECTOR = `#${AGENT_OVERLAY_CONTAINER_ID}, #${OVERLAY_CONTAINER_ID}, [data-expect-overlay]`;

const EMPTY_PASS_TEXT = "No accessibility violations found.";

const OVERLAY_EXCLUDE = [
  [`#${AGENT_OVERLAY_CONTAINER_ID}`],
  [`#${OVERLAY_CONTAINER_ID}`],
  ["[data-expect-overlay]"],
];

let cachedAceScript: string | undefined;
let cachedAxeScript: string | undefined;

const loadAceScript = () => {
  if (!cachedAceScript) {
    const require = createRequire(import.meta.url);
    const aceScriptPath = require.resolve("accessibility-checker-engine/ace.js");
    cachedAceScript = fs.readFileSync(aceScriptPath, "utf8");
  }
  return cachedAceScript;
};

const loadAxeScript = () => {
  if (!cachedAxeScript) {
    const require = createRequire(import.meta.url);
    const axeScriptPath = require.resolve("axe-core/axe.min.js");
    cachedAxeScript = fs.readFileSync(axeScriptPath, "utf8");
  }
  return cachedAxeScript;
};

const toImpact = (value: string | undefined): AccessibilityViolation["impact"] => {
  if (value === "critical" || value === "serious" || value === "moderate" || value === "minor") {
    return value;
  }
  return "moderate";
};

const mapAxeNode = (node: AxeNode): AccessibilityNode => ({
  selector: node.target.join(" "),
  html: node.html,
  failureSummary: node.failureSummary ?? "",
});

const mapAxeRuleNodes = (rule: AxeRuleResult) => ({
  ruleId: rule.id,
  description: rule.description,
  nodes: rule.nodes.map(mapAxeNode),
});

const mapAxeViolations = (rules: readonly AxeRuleResult[]): AccessibilityViolation[] =>
  rules.map((rule) => ({
    ...mapAxeRuleNodes(rule),
    impact: toImpact(rule.impact),
    helpUrl: rule.helpUrl,
    wcagTags: rule.tags,
  }));

const mapAxeIncomplete = (rules: readonly AxeRuleResult[]): AccessibilityIncomplete[] =>
  rules.map(mapAxeRuleNodes);

const mapIbmViolations = (report: IbmReport): AccessibilityViolation[] =>
  report.results
    .filter(
      (result) =>
        result.value[0] === "VIOLATION" &&
        (result.value[1] === "FAIL" || result.value[1] === "POTENTIAL"),
    )
    .map((issue) => ({
      impact: IBM_SEVERITY_TO_IMPACT[issue.value[0]] ?? "moderate",
      ruleId: issue.ruleId,
      description: issue.message,
      helpUrl: `https://able.ibm.com/rules/archives/latest/doc/${issue.ruleId}`,
      wcagTags: [],
      nodes: [
        {
          selector: issue.path?.dom ?? "",
          html: issue.snippet ?? "",
          failureSummary: issue.message,
        },
      ],
    }));

const failedEngine = (cause: string): AccessibilityEngineResult => ({
  status: "failed",
  cause,
  violations: [],
  incomplete: [],
});

const completedEngine = (
  violations: readonly AccessibilityViolation[],
  incomplete: readonly AccessibilityIncomplete[] = [],
): AccessibilityEngineResult => ({
  status: "completed",
  violations,
  incomplete,
});

const buildAxeContext = (selector: string | undefined) => {
  if (selector) {
    return { include: [[selector]], exclude: OVERLAY_EXCLUDE };
  }
  return { exclude: OVERLAY_EXCLUDE };
};

export const presentAccessibilityAudit = (
  result: AccessibilityAuditResult,
): AccessibilityAuditPresentation => {
  const enginesFailed =
    result.engines.axe.status === "failed" || result.engines.ibm.status === "failed";
  const hasFindings = result.violations.length > 0 || result.incomplete.length > 0;
  if (!enginesFailed && !hasFindings) {
    return { kind: "empty-pass", text: EMPTY_PASS_TEXT };
  }
  return { kind: "report", data: result };
};

export const runAccessibilityAudit = Effect.fn("Accessibility.runAccessibilityAudit")(function* (
  page: Page,
  options: AccessibilityAuditOptions = {},
) {
  const tags = options.tags ?? DEFAULT_WCAG_TAGS;
  const axeContext = buildAxeContext(options.selector);
  const axeRunOptions = { runOnly: { type: "tag", values: [...tags] } };
  const axeRunExpression = `axe.run(${JSON.stringify(axeContext)}, ${JSON.stringify(axeRunOptions)})`;
  const aceScript = loadAceScript();
  const overlayHostSelector = EXPECT_OVERLAY_HOST_SELECTOR;

  const [axeOutcome, ibmOutcome] = yield* Effect.all(
    [
      Effect.tryPromise({
        try: async (): Promise<AxeRunResult> => {
          await page.addScriptTag({ content: loadAxeScript() });
          return page.evaluate(axeRunExpression);
        },
        catch: (cause) => new AccessibilityAuditError({ engine: "axe-core", cause: String(cause) }),
      }).pipe(
        Effect.map((value) =>
          completedEngine(
            mapAxeViolations(value.violations),
            mapAxeIncomplete(value.incomplete ?? []),
          ),
        ),
        Effect.catchTag("AccessibilityAuditError", (error) =>
          Effect.logWarning("axe-core audit failed", { cause: error.cause }).pipe(
            Effect.as(failedEngine(error.cause)),
          ),
        ),
      ),
      Effect.tryPromise({
        try: () => page.evaluate(aceScript),
        catch: (cause) =>
          new AccessibilityAuditError({ engine: "ibm-equal-access", cause: String(cause) }),
      }).pipe(
        // HACK: page.evaluate erases types across the serialization boundary; IBM engine has no TS types
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: (): Promise<IbmReport> =>
              page.evaluate(async (hostSelector: string) => {
                const ace = (globalThis as any).ace;
                const checker = new ace.Checker();
                const report = await checker.check(document, ["WCAG_2_2"]);
                const isOwnedOverlayNode = (node: any) => {
                  const element = node?.elem ?? node;
                  if (!element) {
                    return false;
                  }
                  if (typeof element.closest === "function" && element.closest(hostSelector)) {
                    return true;
                  }
                  const host = element.getRootNode?.()?.host;
                  if (host && typeof host.matches === "function") {
                    return host.matches(hostSelector) || Boolean(host.closest(hostSelector));
                  }
                  return false;
                };
                return {
                  results: report.results
                    .filter((item: any) => !isOwnedOverlayNode(item.node))
                    .map(({ node: _ignoredNode, ...rest }: any) => rest),
                };
              }, overlayHostSelector),
            catch: (cause) =>
              new AccessibilityAuditError({ engine: "ibm-equal-access", cause: String(cause) }),
          }),
        ),
        Effect.map((value) => completedEngine(mapIbmViolations(value))),
        Effect.catchTag("AccessibilityAuditError", (error) =>
          Effect.logWarning("IBM Equal Access audit failed", { cause: error.cause }).pipe(
            Effect.as(failedEngine(error.cause)),
          ),
        ),
      ),
    ] as const,
    { concurrency: 2 },
  );

  const axeRuleIds = new Set(axeOutcome.violations.map((violation) => violation.ruleId));
  const ibmViolations =
    axeOutcome.status === "completed"
      ? ibmOutcome.violations.filter((violation) => !axeRuleIds.has(violation.ruleId))
      : ibmOutcome.violations;

  const cloneNode = (node: AccessibilityNode): AccessibilityNode => ({
    selector: node.selector,
    html: node.html,
    failureSummary: node.failureSummary,
  });
  const cloneViolation = (violation: AccessibilityViolation): AccessibilityViolation => ({
    impact: violation.impact,
    ruleId: violation.ruleId,
    description: violation.description,
    helpUrl: violation.helpUrl,
    wcagTags: [...violation.wcagTags],
    nodes: violation.nodes.map(cloneNode),
  });
  const cloneIncomplete = (item: AccessibilityIncomplete): AccessibilityIncomplete => ({
    ruleId: item.ruleId,
    description: item.description,
    nodes: item.nodes.map(cloneNode),
  });

  const violations = [...axeOutcome.violations, ...ibmViolations]
    .sort((left, right) => (IMPACT_ORDER[left.impact] ?? 3) - (IMPACT_ORDER[right.impact] ?? 3))
    .map(cloneViolation);
  const incomplete = axeOutcome.incomplete.map(cloneIncomplete);

  yield* Effect.logInfo("Accessibility audit complete", {
    axeStatus: axeOutcome.status,
    ibmStatus: ibmOutcome.status,
    axeCause: axeOutcome.cause,
    ibmCause: ibmOutcome.cause,
    axeViolationCount: axeOutcome.status === "completed" ? axeOutcome.violations.length : undefined,
    ibmViolationCount: ibmOutcome.status === "completed" ? ibmViolations.length : undefined,
    incompleteCount: incomplete.length,
    totalViolationCount: violations.length,
  });

  return {
    engines: {
      axe: {
        ...axeOutcome,
        violations: axeOutcome.violations.map(cloneViolation),
        incomplete: axeOutcome.incomplete.map(cloneIncomplete),
      },
      ibm: {
        ...ibmOutcome,
        violations: ibmViolations.map(cloneViolation),
      },
    },
    violations,
    incomplete,
    summary: {
      total: violations.length,
      critical: violations.filter((violation) => violation.impact === "critical").length,
      serious: violations.filter((violation) => violation.impact === "serious").length,
      moderate: violations.filter((violation) => violation.impact === "moderate").length,
      minor: violations.filter((violation) => violation.impact === "minor").length,
      incomplete: incomplete.length,
    },
  };
});
