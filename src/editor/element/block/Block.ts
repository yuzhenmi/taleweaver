import Element from '../Element';
import Document from '../Document';
import Inline from '../inline/Inline';
import PageLayout from '../../layout/PageLayout';
import BlockLayout from '../../layout/BlockLayout';

export default interface Block extends Element {
  getType(): string;
  getDocument(): Document;
  getInlines(): Inline[];
  getInlineAt(position: number): Inline | null;
  buildBlockLayout(pageLayout: PageLayout): BlockLayout;
}

export type BlockClass = new (document: Document, onCreateInlines: (block: Block) => Inline[]) => Block;
