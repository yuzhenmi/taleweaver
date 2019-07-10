import { ResolvedPosition } from '../Element';
import InlineElement from '../InlineElement';

export default function getInlinePosition(position: ResolvedPosition): ResolvedPosition {
  if (position.element instanceof InlineElement) {
    return position;
  }
  const child = position.child;
  if (!child) {
    throw new Error(`Failed to get position at ${position.offset} of element ${position.element.getID()}.`);
  }
  return getInlinePosition(child);
}
