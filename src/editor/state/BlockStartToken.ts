interface Attributes {
  [key: string]: any;
}

class BlockStartToken {
  private type: string;
  private attributes: Attributes;

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

export default BlockStartToken;
