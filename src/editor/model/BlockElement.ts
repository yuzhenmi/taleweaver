import Element from './Element';
import Document from './Document';
import InlineElement from './InlineElement';

export default interface BlockElement extends Element {
  getParent(): Document;
  getChildren(): InlineElement[];
  appendChild(child: InlineElement): void;
}
