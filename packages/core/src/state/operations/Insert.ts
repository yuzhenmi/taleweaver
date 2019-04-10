import Operation from '../Operation';
import Token from '../Token';

export default class Insert extends Operation {
  protected at: number;
  protected tokens: Token[];

  constructor(at: number, tokens: Token[]) {
    super();
    this.at = at;
    this.tokens = tokens;
  }

  getType(): string {
    return 'Insert';
  }

  getDelta(): number {
    return this.tokens.length;
  }

  getAt(): number {
    return this.at;
  }

  getTokens(): Token[] {
    return this.tokens;
  }
}
