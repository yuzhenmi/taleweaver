import Token from './Token';

class State {
  protected tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  getTokens(): Token[] {
    return this.tokens;
  }
}

export default State;
