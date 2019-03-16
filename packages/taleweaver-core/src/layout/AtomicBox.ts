import Box from './Box';
import ViewportBoundingRect from './ViewportBoundingRect';

export default abstract class AtomicBox extends Box {
  protected breakable: boolean;

  constructor(selectableSize: number, width: number, height: number, breakable: boolean) {
    super(selectableSize, width, height);
    this.breakable = breakable;
  }

  abstract resolveViewportPositionToSelectableOffset(x: number): number;

  abstract resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[];
}
