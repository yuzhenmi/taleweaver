interface Attributes {
  [key: string]: any;
}

class DocStartToken {
  private attributes: Attributes;

  constructor(attributes: Attributes) {
    this.attributes = attributes;
  }

  getAttributes(): Attributes {
    return this.attributes;
  }
}

export default DocStartToken;
