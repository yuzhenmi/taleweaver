import PageLayoutPosition from './PageLayoutPosition';
import BlockLayout from '../../layout/BlockLayout';

export default class BlockLayoutPosition {
  private pageLayoutPosition: PageLayoutPosition;
  private blockLayout: BlockLayout;
  private position: number;

  constructor(pageLayoutPosition: PageLayoutPosition, blockLayout: BlockLayout, position: number) {
    this.pageLayoutPosition = pageLayoutPosition;
    this.blockLayout = blockLayout;
    this.position = position;
  }

  getPageLayoutPosition(): PageLayoutPosition {
    return this.pageLayoutPosition;
  }

  getBlockLayout(): BlockLayout {
    return this.blockLayout;
  }

  getPosition(): number {
    return this.position;
  }
}
