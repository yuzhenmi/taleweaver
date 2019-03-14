import BlockBox from './BlockBox';

type Child = BlockBox;

export default class PageLayout {
  protected children: Child[];
  protected selectableSize: number;

  constructor() {
    this.children = [];
    this.selectableSize = 0;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }
}
