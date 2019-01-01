import Box from '../Box';
import Line from '../Line';

export default function buildLinesFromBoxes(lineWidth: number, boxes: Box[]): Line[] {
  const lines: Line[] = [];
  let cumulatedWidth = 0;
  let cumulatedBoxes: Box[] = [];
  boxes.forEach(box => {
    if (cumulatedWidth + box.getWidth() > lineWidth) {
      lines.push(new Line(lineWidth, cumulatedBoxes));
      cumulatedWidth = 0;
      cumulatedBoxes = [];
    }
    cumulatedWidth += box.getWidth();
    cumulatedBoxes.push(box);
  });
  if (cumulatedBoxes.length > 0) {
    lines.push(new Line(lineWidth, cumulatedBoxes));
  }
  return lines;
}
