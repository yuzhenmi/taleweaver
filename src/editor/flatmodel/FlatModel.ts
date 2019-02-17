import Token from './Token';

class FlatModel {
  private tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  getTokens(): Token[] {
    return this.tokens;
  }
}

export default FlatModel;
