import BlockElement from './BlockElement';
import InlineElement from './InlineElement';
import LineBreakLineBreakElement from './LineBreakElement';

export default class ParagraphElement extends BlockElement {
  constructor() {
    super();
    this.appendChild(new LineBreakLineBreakElement());
  }

  appendChild(child: InlineElement) {
    // Insert before line break
    this.children.splice(-2, 0, child);
  }

  getType(): string {
    return 'Paragraph';
  }
}
