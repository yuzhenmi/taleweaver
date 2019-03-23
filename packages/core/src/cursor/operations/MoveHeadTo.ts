import Operation from '../Operation';

export default class MoveHeadTo implements Operation {
  protected offset: number;

  constructor(offset: number) {
    this.offset = offset;
  }

  getOffset(): number {
    return this.offset;
  }
}
