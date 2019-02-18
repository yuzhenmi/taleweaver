import Block from './Block';

class Paragraph extends Block {
  static getType(): string {
    return 'Paragraph';
  }

  getType(): string {
    return Paragraph.getType();
  }
}

export default Paragraph;
