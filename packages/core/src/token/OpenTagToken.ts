import Attributes from './Attributes';

class OpenTagToken {
  protected type: string;
  protected id: string;
  protected attributes: Attributes;

  constructor(type: string, id: string, attributes: Attributes) {
    this.type = type;
    this.id = id;
    this.attributes = attributes;
  }

  getType(): string {
    return this.type;
  }

  getID(): string {
    return this.id;
  }

  getAttributes(): Attributes {
    return this.attributes;
  }
}

export default OpenTagToken;
