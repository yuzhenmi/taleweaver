import Box from './Box';

export default abstract class AtomicBox extends Box {
  protected breakable: boolean;

  constructor(selectableSize: number, width: number, height: number, breakable: boolean) {
    super(selectableSize, width, height);
    this.breakable = breakable;
  }
}
