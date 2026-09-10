# Axe injection remediation r2

Source identity:
- Installed global expect-cli@0.1.3 not mutated
- Clone `/Users/viking/Projekt/expect` @ fixed point `39e97500725783490136a8fc7040e6e4dbaafa44`
- Branch `fix/axe-script-injection` (dirty, uncommitted)
- Parent hold: grok-expect-fix2-01a08cd8
- IO lab / CE / Rail / siblings not mutated

Activity refresh:
- Open PRs still MCP cleanup / demo / video / symlink / stalled run / browser cleanup / rrweb
- None touch `packages/browser/src/accessibility.ts`

R1 review FAIL addressed:
1. `axe-core@^4.13.0` added to `expect-cli` (`apps/cli/package.json`) so packed `require.resolve("axe-core/axe.min.js")` works. `apps/cli/tests/runtime-deps.test.ts` passed after `vp pack`.
2. Overlay filter is host match only (`exclude` selectors + IBM `closest`/`shadow host`). No substring `includes` on product html/selector. Fixture keeps product `img` with `data-doc="__expect_agent_overlay__"`.
3. Tests no longer silent-pass WebKit. Live engine-failure, live incomplete `color-contrast`, IBM-failed presenter, product SVG required when IBM completed.
4. Mapping: shared `mapAxeNode` / `mapAxeRuleNodes`. Presentation members are interfaces; union alias remains for the discriminant.
5. Lockfile surgical: only `@axe-core/playwright` removal + `axe-core@4.13.0` importers/snapshots. No deprecated-field churn.
6. MCP `jsonResult` WeakSet circular: clone engine vs top-level violation graphs so packed JSON keeps `ruleId`.
7. Build-generated caveat: `@expect/browser` typecheck needs `pnpm --filter @expect/browser build` (`src/generated` gitignored). After build, browser typecheck **pass**. LoAF `frame` implicit any was missing generated types, not this hunk.
8. Packed isolated install (not global): `npm pack` + `npm install --omit=dev` tarball in tmp; resolve axe 4.13.0 from packed `dist/browser-mcp.js`; MCP `accessibility_audit` Chromium + WebKit.

Executed:
- `pnpm --filter @expect/browser build`
- `pnpm --filter expect-cli build` (`vp pack`)
- `pnpm --filter @expect/browser typecheck` pass
- `pnpm --filter @expect/browser check` format pass; 4 pre-existing lint warnings
- `pnpm --filter expect-cli check` format pass; 1 pre-existing lint warning
- `pnpm --filter expect-cli test tests/runtime-deps.test.ts` pass
- `pnpm --filter @expect/browser test tests/accessibility.test.ts tests/packed-cli-accessibility.test.ts` **12 passed** (9 source + 3 packed: resolve, chromium, webkit)

Not done:
- No global `npm i -g expect-cli`, no publish, no PR
- `expect-cli` `pnpm typecheck` still fails pre-existing `expect-sdk/effect` (layers.ts / run-test.ts)

Safe install after fresh Standards/Spec pass:
1. Review dirty tree on `fix/axe-script-injection`
2. `pnpm install && pnpm --filter @expect/browser build && pnpm --filter expect-cli build`
3. Re-run browser accessibility + packed-cli tests
4. Only then, if authorized: install the packed tarball (never patch fnm `dist/` by hand)

Publish r3 (grok-expect-publish-01a08cd8):
- Re-ran 12 tests + runtime-deps + browser typecheck: pass
- Diff vs 39e9750 is the reviewed files only (plus tests/docs untracked in that review)
- No npm registry publish
- CLI expect-sdk/effect typecheck failure remains pre-existing
