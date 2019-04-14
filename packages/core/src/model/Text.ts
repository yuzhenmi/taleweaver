import Attributes from '../state/Attributes';
import InlineElement from './InlineElement';

export default class Text extends InlineElement {

  getType() {
    return 'Text';
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
