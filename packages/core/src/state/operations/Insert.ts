import Operation from './Operation';
import Token from '../Token';

export default class Insert extends Operation {
  private at: number;
  private tokens: Token[];

  constructor(at: number, tokens: Token[]) {
    super();
    this.at = at;
    this.tokens = tokens;
  }

  getType(): string {
    return 'Insert';
  }

  getAt(): number {
    return this.at;
  }

  getTokens(): Token[] {
    return this.tokens;
  }
}
