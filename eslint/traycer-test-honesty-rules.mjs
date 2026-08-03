/**
 * Rules for TEST files, aimed at one specific failure this project keeps
 * producing: **the change that makes the check stop complaining.**
 *
 * Every rule here comes from a real near-miss, not from a style preference,
 * and each names the near-miss. They are separate from
 * `traycer-type-safety-rules.mjs` because that file is about what SHIPPED
 * code may do; this one is about what a test may claim.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY CONFIGURATION AND NOT VIGILANCE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Four instances arrived in two days: a default parameter that made
 * `id` and `instanceId` equal in the test whose point was that they differ;
 * an `as SomeType` cast that compiles while accepting any shape; an untyped
 * `vi.fn()` whose recorded arguments are `any`; and `?.` inside an
 * assertion. Four instances is a behaviour, not four slips — and it is the
 * move made *while not thinking about it*, which is exactly the move
 * vigilance cannot catch.
 *
 * The precedent is `requiredArgumentRestrictions`: the default-parameter ban
 * caught the first of the four, in a fixture that would otherwise have been
 * polite about the thing under test. No amount of arguing about style
 * produces that; a rule does.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY *NOT* HERE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The cast (`as TilePane` over a hand-built fixture) is **not** covered, and
 * pretending otherwise would be worse than leaving it out. Banning assertions
 * outright is unlivable, and a selector narrow enough to catch "a cast in a
 * fixture" would miss the next variant while reading as though the class were
 * closed. **A false floor is more dangerous than a known gap** — a gap gets
 * remembered; a floor gets trusted.
 *
 * So: two of four by configuration, one by habit, one already covered.
 */

const testMockTypingRestrictions = [
  {
    /*
     * A NAMED `vi.fn()` with no type argument.
     *
     * Its `mock.calls[0][0]` is `any`, so every assertion against a recorded
     * argument silently passes — a transition returning the WRONG SHAPE
     * satisfies tests named after its contents. Found in
     * `tile-canvas.test.tsx`, where the spy stood in for an
     * `(next: CanvasState) => void` prop.
     *
     * ─── Why NAMED, and not every `vi.fn()` ───
     *
     * Measured: banning all of them flagged **11 sites in
     * `clients/teams-tab`, 8 of which were inline stubs** —
     * `onClick={vi.fn()}` passed only to satisfy a required prop, whose
     * arguments no test ever reads. Typing those buys nothing.
     *
     * `const spy = vi.fn()` is different: **a mock you bother to name is a
     * mock you intend to inspect.** That is a heuristic rather than a proof,
     * and it is the closest a syntactic rule can get to "this mock's
     * recorded arguments will be asserted" — esquery cannot see the
     * statement that reads `spy.mock.calls`.
     *
     * The alternative was 11 edits for 3 real risks, which is the shape this
     * rule set exists to avoid: a gate whose cost exceeds its yield stops
     * being read.
     */
    selector:
      "VariableDeclarator > CallExpression[callee.object.name='vi'][callee.property.name='fn']:not([typeArguments]):not([typeParameters])",
    message:
      "Type the named mock: `vi.fn<(arg: T) => R>()`. An untyped mock records its arguments as `any`, so assertions about them cannot fail.",
  },
];

const assertionDirectnessRestrictions = [
  {
    /*
     * `expect(x?.y).toBeUndefined()` / `.toBeFalsy()` — optional chaining in
     * the subject, checked against a matcher that a MISSING subject
     * satisfies.
     *
     * ─── Narrowed twice, and the second narrowing came from running it ───
     *
     * FIRST: banning `?.` anywhere inside `expect(...)` produced **37
     * errors** in `clients/teams-tab` alone. Almost all harmless — with a
     * value matcher a missing subject yields `undefined`, the comparison
     * FAILS, and the only cost is an error message naming the wrong problem.
     * Shipping that takes the package's lint baseline from 5 to 42, and a
     * 42-error baseline detects nothing — the exact instrument this rule set
     * exists to protect. **A rule whose cost is 37 edits to prevent two
     * defects is a tax, not a gate, and a tax gets suppressed.**
     *
     * SECOND: the narrowed rule listed `toBeNull` alongside `toBeUndefined`
     * and `toBeFalsy`. **That was wrong, and reasoning said otherwise until
     * it was measured.** Vitest's `toBeNull` is strict — `undefined` is not
     * `null`, so a missing subject FAILS it. Probed directly rather than
     * argued:
     *
     *     expect(absent?.y).toBeNull()        FAILS   <- safe
     *     expect(absent?.y).toBeUndefined()   passes  <- hole
     *     expect(absent?.y).toBeFalsy()       passes  <- hole
     *
     * Including `toBeNull` cost two real edits and nearly cost a ticket
     * filed against another team for a defect that was not there. **A rule
     * that flags a safe pattern is the same class of error as a test that
     * cannot fail** — both assert something about code that is not true of
     * it.
     *
     * The fix at a call site is two lines: assert the subject is defined,
     * then narrow with a guard. NOT with `??` — `null ?? x` is `x`, so the
     * nullish operator cannot distinguish "absent" from "legitimately null",
     * which is precisely the distinction being made.
     */
    selector:
      "CallExpression[callee.property.name=/^(toBeUndefined|toBeFalsy)$/][callee.object.callee.name='expect'][callee.object.arguments.0.type='ChainExpression']",
    message:
      "Do not check a `?.` subject with `toBeUndefined`/`toBeFalsy` — a MISSING subject satisfies them, which is what the test was meant to rule out. Assert the subject is defined first, then narrow with a guard (not `??`).",
  },
];

export { testMockTypingRestrictions, assertionDirectnessRestrictions };

export const traycerTestHonestyRestrictions = [
  ...testMockTypingRestrictions,
  ...assertionDirectnessRestrictions,
];
