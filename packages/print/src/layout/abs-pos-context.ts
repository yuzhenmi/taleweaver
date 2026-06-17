import type { ComputedStyle, UsedStyle } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";

/**
 * POSITIONING slice 3 — an absolutely-positioned (`position: absolute`)
 * child captured during the BFC subtree walk, deferred to the second pass at the
 * box that ESTABLISHES its absolute containing block (abc).
 *
 * Mirrors the float precedent: a float registers into the shared
 * `FloatEnvironment` during the walk and the BFC root drains it post-loop; an
 * abs-pos child registers into the shared `AbsPosEnvironment` during the walk and
 * the establishing box drains it post-loop. Where a float carries placement
 * state, this carries the node + its STATIC position (where the box would have
 * been in normal flow), expressed in the abc's coordinate frame (the establishing
 * box's own frame), so the second pass can use it as the `auto`-inset fallback.
 */
export interface PendingAbsChild {
  /** The render node to lay out in the second pass. */
  readonly node: ElementBox;
  /** The node's resolved computed style (carries `position` / `inset*` / sizing). */
  readonly computedStyle: ComputedStyle;
  /** The node's resolved used style (carries margins / padding / borders). */
  readonly usedStyle: UsedStyle;
  /**
   * The box's STATIC inline offset — where the in-flow algorithm would have
   * placed its inline-start, expressed in the abc's coordinate frame (the
   * establishing box's own frame). Used as the `auto`-inline-inset fallback.
   */
  readonly staticInlineOffset: number;
  /** The box's STATIC block offset in the abc's coordinate frame. */
  readonly staticBlockOffset: number;
}

/**
 * The mutable collection of abs-pos children whose containing block is a given
 * box. Created fresh by the establishing box (via `makeChildContext` /
 * `makeRootContext`) and shared down the subtree — exactly like
 * `FloatEnvironment` is created fresh by a BFC root and shared down — so a
 * descendant's abs-pos child "rises" to the nearest abc-establishing ancestor.
 * The establishing box drains the list in its post-loop second pass.
 */
export interface AbsPosEnvironment {
  /** Register a pending abs-pos child captured during the subtree walk. */
  register(child: PendingAbsChild): void;
  /** The pending children registered against this abc, in document order. */
  drain(): readonly PendingAbsChild[];
}

export function createAbsPosEnvironment(): AbsPosEnvironment {
  const pending: PendingAbsChild[] = [];
  return {
    register(child) {
      pending.push(child);
    },
    drain() {
      return pending;
    },
  };
}
