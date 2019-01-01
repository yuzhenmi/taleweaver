import Element from '../Element';
import Document from '../Document';
import Inline from '../inline/Inline';
import BlockLayout from '../../layout/BlockLayout';

export default interface Block extends Element {
  getType(): string;
  getDocument(): Document;
  getInlines(): Inline[];
  getBlockLayout(): BlockLayout;
  getPositionInDocument(): number;
  getInlineAt(position: number): Inline | null;
}

export type BlockClass = new (document: Document, onCreateInlines: (block: Block) => Inline[]) => Block;
