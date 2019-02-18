import Inline from './Inline';

class Text extends Inline {
  static getType(): string {
    return 'Text';
  }

  getType(): string {
    return Text.getType();
  }
}

export default Text;
