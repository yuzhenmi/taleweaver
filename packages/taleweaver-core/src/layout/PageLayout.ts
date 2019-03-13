import BlockBox from './BlockBox';

type Child = BlockBox;

export default class PageLayout {
  protected children: Child[];

  constructor() {
    this.children = [];
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
  }

  getChildren(): Child[] {
    return this.children;
  }
}
