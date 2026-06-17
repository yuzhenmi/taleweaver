/**
 * POSITIONING slice 6 — offscreen-surface seam for `opacity` group compositing.
 *
 * A box with `opacity < 1` paints its WHOLE atomic subtree into a temporary
 * offscreen surface at full opacity, then composites that surface onto the
 * parent canvas with `globalAlpha = opacity` (CSS opacity grouping: one
 * translucent region, not additive per-child alpha).
 *
 * The offscreen surface is obtained through an INJECTABLE FACTORY so the paint
 * path is testable under jsdom — jsdom's canvas 2D context is a stub, so a test
 * installs a fake factory (`setOffscreenSurfaceFactory`) that records the
 * surface's draw calls. The default factory uses a DETACHED `<canvas>` element
 * (`document.createElement("canvas")`, the same primitive the editor controller
 * already uses for its page canvases) — its 2D context is a genuine
 * `CanvasRenderingContext2D` and the element is itself a `CanvasImageSource`, so
 * the path is fully type-safe (no casts). This is the standard browser technique
 * for an offscreen drawing buffer; it carries ZERO runtime dependency.
 *
 * The factory is a module-level singleton seam (mirroring how the renderer reads
 * other module-level config); `resetOffscreenSurfaceFactory()` restores the
 * default so a test's fake never leaks across files.
 */

/**
 * An offscreen drawing surface: a 2D context to paint the opacity group into,
 * plus the backing `CanvasImageSource` the parent `ctx.drawImage`s.
 */
export interface OffscreenSurface {
  /** The 2D context the group subtree paints into (at full opacity). */
  readonly ctx: CanvasRenderingContext2D;
  /** The backing image the parent composites via `ctx.drawImage(canvas, x, y)`. */
  readonly canvas: CanvasImageSource;
}

/**
 * Creates an offscreen surface of the given device-pixel size. The whole group
 * subtree paints into `surface.ctx`; the caller then composites `surface.canvas`
 * onto the parent ctx at the group's alpha.
 */
export type OffscreenSurfaceFactory = (width: number, height: number) => OffscreenSurface;

/**
 * The default factory: a detached `HTMLCanvasElement` + its true 2D context. The
 * element is a `CanvasImageSource` (so the parent can `drawImage` it) and its
 * context is a real `CanvasRenderingContext2D` — no type bridging. Throws if the
 * 2D context can't be obtained, surfacing the gap rather than silently dropping
 * the opacity group.
 */
const defaultFactory: OffscreenSurfaceFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  // Guard against zero-area surfaces (a 0 dimension yields an unusable context).
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("opacity compositing could not obtain a 2D context from the offscreen canvas");
  }
  return { ctx, canvas };
};

let activeFactory: OffscreenSurfaceFactory = defaultFactory;

/** The factory the renderer calls to obtain an opacity-group offscreen surface. */
export function createOffscreenSurface(width: number, height: number): OffscreenSurface {
  return activeFactory(width, height);
}

/** Install a custom offscreen-surface factory (used by tests to inject a fake). */
export function setOffscreenSurfaceFactory(factory: OffscreenSurfaceFactory): void {
  activeFactory = factory;
}

/** Restore the default detached-`<canvas>`-backed factory. */
export function resetOffscreenSurfaceFactory(): void {
  activeFactory = defaultFactory;
}
