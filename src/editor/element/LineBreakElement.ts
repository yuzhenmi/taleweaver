import InlineElement from './InlineElement';

export default class LineBreakElement extends InlineElement {
  getType(): string {
    return 'LineBreak';
  }

  getSize(): number {
    return 1;
  }
}
