import Inline from './Inline';

class Text extends Inline {
  static getType(): string {
    return 'Text';
  }

  getType(): string {
    return Text.getType();
  }

  getSize(): number {
    return this.content.length + 2;
  }
}

export default Text;
