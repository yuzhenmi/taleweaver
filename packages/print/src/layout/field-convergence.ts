// F-3: the §4.4 width-convergence driver for layout-dependent page-fields.
//
// THE feedback: a page-field's rendered width depends on its value's digit count
// ("of 9" vs "of 100"). When the wider value makes a header/footer WRAP to an extra
// line, the slot grows taller, the body area shrinks, the page count rises, and the
// value's width can change again — a genuine fixpoint. This driver is the bounded
// iterate-to-fixpoint that resolves it (mirrors the FN-6 footnote convergence).
//
// It is PURE control flow: it knows nothing about layout. The caller supplies a
// `runIteration(grownWidths)` that lays the document out with each page-field's
// placeholder reservation overridden to the given width and reports back the
// resulting page count + each field's widest resolved value width. The driver grows
// any reservation a value overflows and re-runs, GROW-ONLY (a reservation never
// shrinks — so the page count is monotonically non-decreasing and the loop cannot
// truly oscillate; the 2-cycle pin is a defensive backstop). It stops when every
// value fits its reservation (converged), on a repeated page count (pinned to the
// larger), or at `MAX_FIELD_CONVERGENCE_ITERATIONS` (bound — returns the largest,
// safe over-reservation). Reserved-width placeholders (§4.4a) make pass 1 final for
// essentially every real document, so this loop is the correctness backstop, not
// the common path.

/** Bound on convergence passes (mirror FN-6). */
export const MAX_FIELD_CONVERGENCE_ITERATIONS = 5;

/** Sub-pixel tolerance so float width noise never triggers spurious growth. */
export const WIDTH_EPSILON = 0.01;

/** A page-field's identity + its render-time (placeholder) reserved width in px. */
export interface ConvergenceField {
  readonly embedKey: string;
  readonly reservedWidth: number;
}

/** What one layout pass reports back: the page count + each field's widest value width. */
export interface ConvergenceIteration {
  readonly pageCount: number;
  readonly maxValueWidthByKey: ReadonlyMap<string, number>;
}

/** The driver's outcome: the final iteration's full output + the widths it used. */
export interface FieldConvergenceOutcome<R extends ConvergenceIteration> {
  /** The final iteration's result (the layout the caller should keep). */
  readonly result: R;
  /**
   * The reservation widths APPLIED to produce `result` (empty ⇒ none grown). This
   * always corresponds to `result`'s iteration — never a step ahead — so a consumer
   * (e.g. the dev invariant, or a future carry-forward) can pair the two safely.
   */
  readonly grownWidths: ReadonlyMap<string, number>;
  /** Number of `runIteration` calls made (≤ `maxIterations`). */
  readonly iterations: number;
  /** True iff every value fit its reservation (false ⇒ pinned or bound-hit). */
  readonly converged: boolean;
}

/**
 * Grow each field whose resolved value width exceeds its current reservation. Returns
 * the new (grown) width map, or `null` if nothing overflowed (the converged signal).
 * Grow-only: a field already in `grownWidths` is measured against its grown width.
 */
function growReservations(
  fields: readonly ConvergenceField[],
  grownWidths: ReadonlyMap<string, number>,
  maxValueWidthByKey: ReadonlyMap<string, number>,
): Map<string, number> | null {
  let grew = false;
  const next = new Map(grownWidths);
  for (const field of fields) {
    const reserved = grownWidths.get(field.embedKey) ?? field.reservedWidth;
    const needed = maxValueWidthByKey.get(field.embedKey) ?? 0;
    if (needed > reserved + WIDTH_EPSILON) {
      next.set(field.embedKey, needed);
      grew = true;
    }
  }
  return grew ? next : null;
}

/**
 * Run the bounded width-convergence loop. `runIteration` lays the document out with
 * the given per-field reservation overrides and reports the page count + value widths.
 * Returns the final iteration's output, the widths it used, and whether it converged.
 *
 * An empty `fields` list (no page-fields) runs `runIteration` exactly once with no
 * overrides — byte-identical to a no-field layout.
 */
export function runFieldConvergence<R extends ConvergenceIteration>(
  fields: readonly ConvergenceField[],
  runIteration: (grownWidths: ReadonlyMap<string, number>) => R,
  maxIterations: number = MAX_FIELD_CONVERGENCE_ITERATIONS,
): FieldConvergenceOutcome<R> {
  const cap = Math.max(1, maxIterations);
  const seenCounts = new Set<number>();
  // `grownWidths` is ALWAYS the set of overrides that produced the current `result`
  // (updated immediately before each `runIteration`), so the returned pair is never
  // off-by-one. The loop makes at most `cap` `runIteration` calls (strict bound, no
  // overrun on the pin path — mirror FN-6's `for (i < MAX)`).
  let grownWidths: ReadonlyMap<string, number> = new Map();
  let result = runIteration(grownWidths); // pass 1
  let iterations = 1;
  let converged = false;

  while (iterations < cap) {
    const grown = growReservations(fields, grownWidths, result.maxValueWidthByKey);
    if (grown === null) {
      converged = true; // every value fits its reservation
      break;
    }
    // A previously-produced page count reappeared while a field still overflows: this
    // is the (grow-only ⇒ near-unreachable) oscillation backstop. Pin to the LARGER
    // reservation (`grown` ⊇ all prior widths) with one more pass, then stop. No
    // starvation (mirror FN-6's atomic-block tie-break).
    const pin = seenCounts.has(result.pageCount);
    seenCounts.add(result.pageCount);
    grownWidths = grown;
    result = runIteration(grownWidths);
    iterations += 1;
    if (pin) break; // pinned, not converged
  }

  return { result, grownWidths, iterations, converged };
}
