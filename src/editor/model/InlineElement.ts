import Element from './Element';
import BlockElement from './BlockElement';

export default interface InlineElement extends Element {
  getParent(): BlockElement;
}
