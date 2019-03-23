import Operation from '../Operation';

export default class MoveTo implements Operation {
  protected offset: number;

  constructor(offset: number) {
    this.offset = offset;
  }

  getOffset(): number {
    return this.offset;
  }
}
