import Element from '../Element';
import Document from '../Document';
import Inline from '../inline/Inline';
import BlockLayout from '../../layout/Block';

export default interface Block extends Element {
  getDocument(): Document;
  getInlines(): Inline[];
  getBlockLayout(): BlockLayout;
  getPositionInDocument(): number;
  getInlineAt(position: number): Inline | null;
}
