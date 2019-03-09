import BlockBox from './BlockBox';

export default class PageLayout {
  protected blockBoxes: BlockBox[];

  constructor() {
    this.blockBoxes = [];
  }

  insertBlockBox(blockBox: BlockBox) {
    this.blockBoxes.push(blockBox);
  }
}
