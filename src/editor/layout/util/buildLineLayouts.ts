import Box from '../BoxLayout';
import Line from '../LineLayout';

export default function buildLineLayouts(lineWidth: number, boxes: Box[]): Line[] {
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
