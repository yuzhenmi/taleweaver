import InlineElement, { ObjectAtom } from './InlineElement';

export class LineBreakAtom extends ObjectAtom {
  getType(): string {
    return 'LineBreak';
  }

  getWidth(): number {
    return 0;
  }

  getHeight(): number {
    return 0;
  }
}

export default class LineBreakElement extends InlineElement {
  getType(): string {
    return 'LineBreak';
  }

  getSize(): number {
    return 1;
  }

  getAtoms(): LineBreakAtom[] {
    const atom = new LineBreakAtom();
    return [ atom ];
  }
}
