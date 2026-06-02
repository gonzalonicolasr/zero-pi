# Strict TDD Module — Build Phase

> **This module governs the build phase ONLY when Strict TDD Mode is active AND
> a test runner is available.** The build prompt already resolved both
> conditions before pointing you here. If you are reading this, follow every
> instruction.

## TDD Philosophy

TDD is not testing. TDD is **software design driven by tests**. You write a test
that describes what the code SHOULD do, then write the minimum code to make it
real. The tests design the API, the contracts, the behavior. Code is a side
effect of tests.

### The Three Laws

1. **Do NOT write production code** until you have a failing test.
2. **Do NOT write more test** than is necessary to fail.
3. **Do NOT write more code** than is necessary to pass the test.

## TDD Implementation Cycle

For EVERY task assigned to your batch, follow this cycle strictly:

```
FOR EACH TASK:
├── 0. SAFETY NET (only if modifying existing files)
│   ├── Run existing tests for the files being modified
│   ├── Capture baseline: "{N} tests passing"
│   ├── If any FAIL → STOP, report as "pre-existing failure"
│   │   (do NOT fix pre-existing failures — report them in the return envelope)
│   └── This baseline proves you did not break what already worked
│
├── 1. UNDERSTAND
│   ├── Read the task description and its `files:` / `evidence:` bullets
│   ├── Read the relevant spec.md scenarios (these ARE your acceptance criteria)
│   ├── Read the design.md decisions (these CONSTRAIN your approach)
│   ├── Read existing code and test patterns (match the style)
│   └── Determine the test layer (see "Choosing Test Layer" below)
│
├── 2. RED — Write a failing test FIRST
│   ├── Write test(s) that describe the expected behavior from the spec
│   ├── Prefer pure functions where possible (no side effects = easy to test)
│   ├── The test MUST reference production code that does NOT exist yet
│   │   (this guarantees failure — no need to execute to confirm)
│   ├── If the production code/function already exists:
│   │   └── Write a test for the NEW behavior that is NOT yet implemented
│   └── GATE: Do NOT proceed to GREEN until the test is written
│
├── 3. GREEN — Write the MINIMUM code to pass
│   ├── Implement ONLY what the failing test needs
│   ├── "Fake It" is VALID here (hardcoded return values are OK)
│   ├── EXECUTE the focused test → must PASS
│   │   ├── ✅ Passed → proceed to TRIANGULATE or REFACTOR
│   │   └── ❌ Failed → fix the implementation, NOT the test
│   └── GATE: Do NOT proceed until GREEN is confirmed by execution
│
├── 4. TRIANGULATE (MANDATORY for most tasks)
│   ├── DEFAULT: triangulation is REQUIRED. You need a compelling reason to skip it.
│   ├── Add a second test case with DIFFERENT inputs/expected outputs
│   ├── EXECUTE tests → if "Fake It" breaks (the hardcode no longer works):
│   │   └── Generalize to real logic (this is the whole point)
│   ├── Repeat until ALL spec scenarios for this task are covered
│   ├── MINIMUM: at least 2 test cases per behavior (happy path + one edge case)
│   │   ├── One test with data that produces a NON-EMPTY/NON-TRIVIAL result
│   │   └── One test that exercises a DIFFERENT code path
│   ├── WATCH OUT for a GREEN that passes trivially:
│   │   ├── Passes because the component/element isn't rendered → NOT a real GREEN
│   │   ├── Passes because a loop iterates 0 times → NOT a real GREEN
│   │   ├── Passes because the setup never triggers the code path → NOT a real GREEN
│   │   └── A real GREEN means: production code RAN and produced the expected output
│   ├── Skip triangulation ONLY when ALL of these are true:
│   │   ├── The task is purely structural (config file, constant, type export)
│   │   ├── There is literally ONE possible output (no branching, no logic)
│   │   └── You note "Triangulation skipped: {reason}" in the evidence table
│   └── GATE: All spec scenarios for this task have tests before REFACTOR
│
├── 5. REFACTOR — Improve without changing behavior
│   ├── Extract constants (eliminate magic numbers)
│   ├── Extract functions (reduce cyclomatic complexity)
│   ├── Improve naming, remove duplication, push toward pure functions
│   ├── Apply the Boy Scout Rule: leave code cleaner than you found it
│   ├── EXECUTE tests after EACH refactoring step → must STILL PASS
│   │   ├── ✅ Still passing → the refactoring is safe, continue
│   │   └── ❌ Failed → REVERT that step, try a smaller one
│   └── GATE: Tests green after EVERY refactoring change
│
├── 6. Mark the task `[x]` in tasks.md
└── 7. Note any deviations or issues discovered
```

## Choosing Test Layer

```
Determine the test layer by WHAT the task does:
├── Pure logic, utility, calculation, data transformation
│   └── Unit test (always available when a test runner exists)
│
├── Component rendering, user interaction, state changes
│   ├── IF integration tools available → Integration test
│   └── IF NOT → Unit test with mocks (degrade gracefully)
│
├── Multi-component flow, API interaction, context/provider behavior
│   ├── IF integration tools available → Integration test
│   └── IF NOT → Unit test with mocks
│
├── Critical business flow, full user journey, cross-page navigation
│   ├── IF E2E tools available → E2E test
│   ├── IF NOT but integration available → Integration test
│   └── IF neither → Unit test (degrade gracefully)
│
└── Default: Unit test (always the fallback)
```

**Key rule**: use the HIGHEST available layer that fits the task, but NEVER skip
a task because a layer is unavailable — degrade to the next available layer.

## Test Execution

Detect the test runner, in order:

```
├── `.sdd/config.json` → tdd.testCommand (explicit override, fastest)
└── Fallback: detect from package.json / pyproject.toml / go.mod / etc.

When executing tests during the cycle, run ONLY the relevant test file:
├── JS/TS: {runner} {test-file}   (e.g. npm test -- src/utils/tax.test.ts)
├── Python: pytest {test-file}
├── Go: go test ./{package}/... -run {TestName}
└── Adapt to the runner's CLI

Run a focused file, not the whole suite — it keeps the cycle FAST. The full
suite runs once at the end of the build phase (and again in veredicto).
```

## Pure Function Preference

When writing production code in GREEN/TRIANGULATE, prefer pure functions:

```
✅ PREFER (pure — easy to test):
function calculateDiscount(price: number, quantity: number): number {
  return quantity >= 5 ? price * quantity * 0.1 : 0
}

❌ AVOID (impure — hard to test):
function calculateDiscount(item: Item) {
  globalState.lastDiscount = item.price * 0.1  // side effect
  updateDOM()                                   // side effect
  return globalState.lastDiscount
}
```

Pure functions are deterministic (same input → same output), have no side
effects, and are trivially testable. TDD naturally pushes you toward them —
embrace it, but don't force it where it doesn't fit (e.g. stateful components).

## Approval Testing (for refactoring existing code)

When a task REFACTORS existing code (not writing new behavior):

```
BEFORE touching production code:
├── 1. Identify the existing behavior to preserve
├── 2. Write "approval tests" that capture the current behavior:
│   ├── Call the function with known inputs
│   ├── Assert the CURRENT outputs (even if ugly)
│   └── These tests document what the code does NOW
├── 3. Run approval tests → must PASS (they describe current reality)
├── 4. NOW refactor the production code
├── 5. Run approval tests again → must STILL PASS
│   ├── ✅ Passing → refactoring preserved behavior
│   └── ❌ Failing → refactoring broke something, revert
└── 6. If the spec says behavior should CHANGE:
    ├── Update the approval test to the NEW expected behavior
    ├── Run → test FAILS (RED — new behavior not implemented yet)
    └── Implement the new behavior → GREEN
```

## TDD Cycle Evidence (MANDATORY output)

When Strict TDD Mode is active, the build phase MUST produce a **TDD Cycle
Evidence** table. Write it to `.sdd/<slug>/tdd-evidence.md` (create the file on
the first batch; append rows on later batches — never overwrite prior batches'
rows) AND include it in your return envelope so the veredicto phase can audit it.

```markdown
### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| T001 | `path/test.ext` | Unit | ✅ 5/5 | ✅ Written | ✅ Passed | ✅ 3 cases | ✅ Clean |
| T002 | `path/test.ext` | Integration | N/A (new) | ✅ Written | ✅ Passed | ➖ Single | ✅ Clean |
| T003 | `path/test.ext` | Unit | ✅ 2/2 | ✅ Written | ✅ Passed | ✅ 2 cases | ➖ None needed |

### Test Summary
- **Total tests written**: {N}
- **Total tests passing**: {N}
- **Layers used**: Unit ({N}), Integration ({N}), E2E ({N})
- **Approval tests** (refactoring): {N} or "None — no refactoring tasks"
- **Pure functions created**: {N}
```

**Column definitions**:
- **Safety Net**: pre-existing tests run before modifying files. "N/A (new)" for new files.
- **RED**: test written first, referencing code that doesn't exist yet. Always "✅ Written".
- **GREEN**: tests executed and passing after minimal implementation. Must reflect an execution.
- **TRIANGULATE**: extra cases added to force real logic. "➖ Single" if the spec has one scenario.
- **REFACTOR**: code improved with tests still green. "➖ None needed" if already clean.

A build that omits this table when Strict TDD is active will be sent back as
`corregir` by veredicto — the table is the contract.

## Assertion Quality Rules (MANDATORY)

**Every assertion must verify REAL behavior.** A test that passes without
exercising production logic is worse than no test — it gives false confidence.

### Banned Assertion Patterns (NEVER write these)

```
# TRIVIAL ASSERTIONS — the test proves nothing
expect(true).toBe(true)              # ❌ Tautology
expect(1).toBe(1)                    # ❌ Tautology — no production code involved
assert True                          # ❌ Always passes

# EMPTY COLLECTION ASSERTIONS without setup context
expect(result).toEqual([])           # ❌ ONLY valid if you set up conditions for empty
expect(result).toHaveLength(0)       # ❌ Why is it empty? Did production code run?
assert result == []                  # ❌ Prove the emptiness comes from real logic

# TYPE-ONLY ASSERTIONS — proves existence, not behavior
expect(result).toBeDefined()         # ❌ Alone is useless — WHAT is the value?
expect(result).not.toBeNull()        # ❌ Alone is useless — assert the actual value
assert result is not None            # ❌ Alone — assert what result actually IS

# GHOST LOOP — assertion inside a loop that iterates 0 times
const items = screen.queryAllByTestId("item");   // returns []
for (const item of items) {
  expect(item).toHaveTextContent("value");        # ❌ NEVER EXECUTES — dead code
}
# FIX: assert the collection is non-empty FIRST, or set up data so it IS non-empty:
expect(items).toHaveLength(3);                    # ✅ Proves items exist
for (const item of items) { ... }                 # ✅ Now the loop actually runs
```

### What Makes a REAL Assertion

Every assertion must satisfy ALL of these:
1. **Calls production code** — invokes a function, method, or component from the implementation.
2. **Asserts a specific output** — compares against a concrete value derived from the spec.
3. **Would FAIL if the production code were wrong** — change the logic and THIS test breaks.

```
# ✅ REAL assertions — production code determines the result
expect(calculateDiscount(100, 10)).toBe(10)
expect(screen.getByText('Welcome, John')).toBeInTheDocument()
assert response.status_code == 403
expect(result).toHaveLength(3)                     # AND you set up exactly 3 items
```

### Empty Collection Rule

`expect(result).toEqual([])` / `assert len(result) == 0` is ONLY valid when:
1. You set up a precondition that SHOULD produce an empty result.
2. The production code actually ran and filtered/processed data to arrive at empty.
3. A companion test with different setup produces a NON-EMPTY result (triangulation).

If you cannot explain WHY the result is empty from the setup → the assertion is trivial.

### Smoke Test Rule

```
# ❌ SMOKE TEST ONLY — proves nothing about behavior
render(<MyComponent data={mockData} />);
expect(screen.getByTestId("wrapper")).toBeInTheDocument();

# ✅ BEHAVIORAL TEST — proves what the component DOES with the data
render(<MyComponent data={mockData} />);
expect(screen.getByText("Expected Title")).toBeInTheDocument();
expect(screen.getByRole("button")).toHaveTextContent("Submit");
```

"Renders without crash" is a smoke test. It does NOT count toward TDD coverage;
if you need one, it must be accompanied by real behavioral assertions.

### Mock Hygiene Rules

**If you need more mocks than assertions, you are testing at the WRONG level.**

```
├── ≤ 3 mocks for a test file → ✅ Healthy — focused test
├── 4–6 mocks → ⚠️ Consider extracting logic to a pure function
└── 7+ mocks → ❌ STOP — wrong layer
    ├── Extract the logic to a PURE FUNCTION and test it without mocks, OR
    └── Move the test to the integration/E2E layer where real deps exist
```

**Extract-Before-Mock Rule**: if the behavior is a data transformation,
mapping, filtering, or conditional logic, EXTRACT it to a pure function FIRST,
then test the pure function directly — no mocks needed.

### Implementation Detail Coupling Rule

Tests must assert **behavior visible to the user**, not internal details:

```
# ❌ COUPLED — breaks on any style/internal refactor
expect(element.className).toContain("text-xs");
expect(mockService.mock.calls.length).toBe(3);
expect(component.state.isLoading).toBe(true);

# ✅ BEHAVIORAL — survives refactors, tests what users see
expect(screen.getByText("Error: Payment failed")).toBeInTheDocument();
expect(screen.getByRole("alert")).toHaveTextContent("Risk:");
expect(screen.getByRole("button")).toBeDisabled();
```

**CSS class assertions are NEVER valid test assertions.** Verify the semantic
outcome (role, visible text, disabled state) or use a visual-regression/E2E
screenshot — never assert Tailwind/CSS class names.

## Rules (Strict TDD specific)

- NEVER write production code before its test — this is the ONE rule that cannot be broken.
- NEVER skip the GREEN execution gate — you MUST run the test and confirm it passes.
- NEVER skip triangulation when the spec defines multiple scenarios.
- NEVER write trivial assertions (see Banned Patterns) — they are WORSE than no test.
- ALWAYS verify every assertion CALLS production code and asserts a SPECIFIC value.
- ALWAYS run the Safety Net before modifying existing files.
- ALWAYS write the TDD Cycle Evidence table — veredicto checks it.
- If a test-runner execution fails for infrastructure reasons (not a test failure), report it as "Blocked" and continue to the next task.
- For refactoring tasks, ALWAYS write approval tests before touching code.
- Run ONLY the relevant test file during the cycle, not the full suite.
