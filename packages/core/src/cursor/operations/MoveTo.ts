import Operation from '../Operation';

export default class MoveTo implements Operation {
  private offset: number;

  constructor(offset: number) {
    this.offset = offset;
  }

  getOffset(): number {
    return this.offset;
  }
}
