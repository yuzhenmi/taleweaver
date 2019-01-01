import Element from './Element';
import Document from './Document';
import InlineElement from './InlineElement';
import Block from '../layout/Block';

export default interface BlockElement extends Element {
  getDocument(): Document;
  getInlineElements(): InlineElement[];
  appendInlineElement(inlineElement: InlineElement): void;
  getPositionInDocument(): number;
  getInlineElementAt(position: number): InlineElement | null;
  getBlock(): Block;
}
