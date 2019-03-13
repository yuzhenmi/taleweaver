import AtomicBox from './AtomicBox';

export default class TextAtomicBox extends AtomicBox {
  protected content: string;

  constructor(selectableSize: number, width: number, height: number, breakable: boolean, content: string) {
    super(selectableSize, width, height, breakable);
    this.content = content;
  }

  getContent(): string {
    return this.content;
  }
}
