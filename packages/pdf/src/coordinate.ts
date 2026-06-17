/**
 * Engine → PDF coordinate transform. The engine is y-down / top-left / CSS px
 * (1/96in); PDF user space is y-up / bottom-left / point (1/72in). We convert
 * per-coordinate (NOT via a flipped CTM, which would mirror glyphs).
 */
export const PX_TO_PT = 72 / 96; // 0.75

/** Engine point (x,y) in a page of physical height `pageHeightPx` → PDF [x,y] pt. */
export function pointYUp(
  xPx: number,
  yPx: number,
  pageHeightPx: number,
): [number, number] {
  return [xPx * PX_TO_PT, (pageHeightPx - yPx) * PX_TO_PT];
}

/**
 * Engine top-left rect (x,y,w,h) → PDF `re` operands [x,y,w,h] pt, where the PDF
 * y is the rect's BOTTOM edge flipped against the page height.
 */
export function rectYUp(
  xPx: number,
  yPx: number,
  wPx: number,
  hPx: number,
  pageHeightPx: number,
): [number, number, number, number] {
  return [
    xPx * PX_TO_PT,
    (pageHeightPx - yPx - hPx) * PX_TO_PT,
    wPx * PX_TO_PT,
    hPx * PX_TO_PT,
  ];
}

/** Physical page (widthPx, heightPx) → PDF MediaBox [0,0,w,h] in points. */
export function mediaBoxOf(
  widthPx: number,
  heightPx: number,
): [number, number, number, number] {
  return [0, 0, widthPx * PX_TO_PT, heightPx * PX_TO_PT];
}
