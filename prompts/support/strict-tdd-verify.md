# Strict TDD Module — Veredicto Phase

> **This module governs the veredicto phase ONLY when Strict TDD Mode is active
> AND a test runner is available.** The veredicto prompt already resolved both
> conditions before pointing you here. If you are reading this, follow every
> instruction.

## TDD Verification Philosophy

When Strict TDD Mode is active, the review goes beyond "does the code work?" to
"was the code built correctly?" — meaning: was TDD actually followed? The build
phase reports TDD evidence; your job is to validate that evidence against
reality. A failed TDD audit is a **`corregir`** verdict, not `pasa`.

## Step A — TDD Compliance Check

Read the build's **TDD Cycle Evidence** table — from
`.sdd/<slug>/tdd-evidence.md` and/or the build's return envelope — and verify
TDD was actually followed:

```
FOR EACH task row in the TDD Cycle Evidence table:
├── RED column:
│   ├── Must say "✅ Written"
│   ├── Verify: the named test file EXISTS in the codebase
│   └── Flag: CRITICAL if the test file does not exist
│
├── GREEN column:
│   ├── Must say "✅ Passed"
│   ├── Cross-reference with your own test run (Step C):
│   │   └── The listed test file must PASS when YOU run it
│   └── Flag: CRITICAL if the test fails now (was it really green?)
│
├── TRIANGULATE column:
│   ├── "✅ N cases" → verify N test cases exist in the file
│   ├── "➖ Single" → verify the spec truly has only one scenario
│   └── Flag: WARNING if the spec has multiple scenarios but only 1 test case
│
├── SAFETY NET column:
│   ├── "✅ N/N" → existing tests were run before modification (good)
│   ├── "N/A (new)" → verify the file was actually NEW, not modified
│   └── Flag: WARNING if a modified file shows "N/A"
│
└── REFACTOR column:
    └── Not strictly verifiable (subjective) — trust the report

If NO "TDD Cycle Evidence" table is found:
└── Flag: CRITICAL — the build did not report TDD evidence while Strict TDD was
    active. This alone is grounds for a `corregir` verdict.

Summary: "{N}/{total} tasks have complete TDD evidence".
```

## Step B — Test Layer Validation

Classify every test file related to this change by its testing layer:

```
├── Unit test: a single function/class in isolation
│   └── Indicators: no render(), no page., no HTTP calls, mocked deps
├── Integration test: component interaction or user behavior
│   └── Indicators: render(), screen., userEvent., testing-library imports
├── E2E test: full system through a real browser/HTTP
│   └── Indicators: page.goto(), playwright/cypress imports, browser context
└── Unknown: cannot classify → report as-is

Report the distribution (Unit / Integration / E2E counts) and, for each spec
scenario, note which layer covers it. Flag as SUGGESTION (not blocking) if
critical business logic only has unit tests while higher-layer tools exist.
```

## Step C — Run the Tests Yourself

Run the relevant focused tests AND the full suite when available, exactly as
reported, and confirm GREEN is still true. Report the commands you ran and any
failures verbatim. A test that the build reported as ✅ but fails when you run
it is a CRITICAL discrepancy.

## Step D — Changed File Coverage (if a coverage tool is available)

```
IF a coverage tool is available:
├── Run the coverage command
├── Filter to ONLY files created/modified in this change
├── Report per file: line %, branch %, uncovered line ranges
│   ├── ≥ 95% → ✅ Excellent
│   ├── ≥ 80% → ⚠️ Acceptable
│   └── < 80% → ⚠️ Low (list the uncovered lines)
└── Flag: WARNING (never CRITICAL) if a changed file is < 80%

IF NOT available:
└── "Coverage analysis skipped — no coverage tool detected" (not a failure).
```

## Step E — Assertion Quality Audit (MANDATORY)

Scan ALL test files created or modified by this change for trivial/meaningless
assertions:

```
FOR EACH test file related to the change:
├── Scan for BANNED patterns:
│   ├── Tautologies: expect(true).toBe(true), assert True, expect(1).toBe(1)
│   │   └── CRITICAL — the test proves NOTHING
│   ├── Orphan empty checks: expect(result).toEqual([]) / assert len(result) == 0
│   │   └── WARNING unless a companion test with the same setup asserts NON-EMPTY
│   ├── Type-only assertions used alone: toBeDefined(), not.toBeNull(), typeof
│   │   └── WARNING — OK only when COMBINED with a value assertion
│   ├── Assertions that never call production code (no call, no render, no request)
│   │   └── CRITICAL — the test exercises nothing
│   ├── Ghost loops: assertions inside for/forEach over queryAll/filter results
│   │   └── CRITICAL if the collection could be empty — the loop never runs
│   ├── Incomplete TDD cycle: passes because preconditions stop the code running
│   │   └── CRITICAL — the code path was never exercised
│   ├── Smoke-only: render() + toBeInTheDocument() with no behavioral assertion
│   │   └── WARNING — does not count toward TDD coverage
│   ├── Implementation-detail coupling: CSS classes, internal state, mock call counts
│   │   └── WARNING — tests must assert behavior, not implementation
│   └── Mock/assertion ratio: vi.mock()/jest.mock() count vs expect() count
│       └── WARNING if mocks > 2× assertions — wrong test layer
│
├── For each violation: record file, line, the assertion, and why it's trivial.
│
└── Triangulation quality:
    ├── If a behavior with multiple spec scenarios has only 1 test case → WARNING
    └── If all cases assert the SAME trivial value (all empty arrays) → WARNING

Summary: "{N} trivial assertions found across {N} files".
```

## Step F — Quality Metrics (if tools available)

```
IF a linter is available  → run on changed files; report errors/warnings.
IF a type checker is available → run; filter to changed files; report type errors.
IF neither → "Quality metrics skipped — no tools detected" (not a failure).
```

## Verdict Mapping

Fold the TDD audit into the standard verdict:

- A missing TDD Cycle Evidence table, a CRITICAL assertion violation
  (tautology, no-production-call, ghost loop, incomplete cycle), or a test that
  fails when you run it → **`corregir`** with the specific defects named.
- WARNING-level findings (low coverage, smoke tests, mock-heavy, impl-detail
  coupling, thin triangulation) do not by themselves force `corregir`, but list
  them in the verdict reasoning so the next build round can address them.
- Coverage/quality-tool absence is never a failure — note it and move on.
- `pasa` requires: all evidence present, every reported GREEN actually green
  when you run it, and no CRITICAL assertion violations.

## Report Section (include in the verdict reasoning)

```markdown
### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ / ❌ | Found in tdd-evidence.md / Missing |
| All tasks have tests | ✅ / ❌ | {N}/{total} tasks have test files |
| RED confirmed (tests exist) | ✅ / ⚠️ | {N}/{total} test files verified |
| GREEN confirmed (tests pass) | ✅ / ❌ | {N}/{total} pass on execution |
| Triangulation adequate | ✅ / ⚠️ / ➖ | {N} triangulated / {N} single-case |
| Safety Net for modified files | ✅ / ⚠️ | {N}/{total} had a safety net |

**TDD Compliance**: {N}/{total} checks passed

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | {N} | {N} | {tool} |
| Integration | {N} | {N} | {tool or "not installed"} |
| E2E | {N} | {N} | {tool or "not installed"} |

### Assertion Quality
| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| ... | ... | ... | ... | ... |

**Assertion quality**: {N} CRITICAL, {N} WARNING
(or "✅ All assertions verify real behavior")
```

## Rules (Strict TDD Verify specific)

- ALWAYS check the TDD Cycle Evidence table — it is the primary artifact.
- ALWAYS cross-reference the reported test files against an actual run — never trust the report blindly.
- ALWAYS run the Assertion Quality Audit (Step E) — trivial tests are WORSE than missing tests.
- If no TDD evidence table exists while Strict TDD is active → CRITICAL → `corregir`.
- If a tautology assertion is found → CRITICAL → it MUST be rewritten → `corregir`.
- Coverage and quality metrics are informational — WARNING at most, never the sole cause of `corregir`.
- DO NOT fix issues — only report and choose the verdict. The build phase fixes on the `corregir` re-run.
- If coverage/quality tools are absent, say so cleanly and move on — never flag a missing tool as a failure.
