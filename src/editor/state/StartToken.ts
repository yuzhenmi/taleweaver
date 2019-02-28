interface Attributes {
  id: string;
  [key: string]: any;
}

abstract class StartToken {
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

export default StartToken;
