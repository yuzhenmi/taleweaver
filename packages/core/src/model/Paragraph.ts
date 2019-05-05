import Attributes from '../token/Attributes';
import BlockElement from './BlockElement';

export default class Paragraph extends BlockElement {

  getType() {
    return 'Paragraph';
  }

  getAttributes() {
    return {
      id: this.id!,
    };
  }

  onStateUpdated(attributes: Attributes) {
    return false;
  }
}
