interface Attributes {
  id: string;
  [key: string]: any;
}

class OpenTagToken {
  protected type: string;
  protected attributes: Attributes;

  constructor(type: string, attributes: Attributes) {
    this.type = type;
    this.attributes = attributes;
  }

  getType(): string {
    return this.type;
  }

  getAttributes(): Attributes {
    return this.attributes;
  }
}

export default OpenTagToken;
