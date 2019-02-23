import { TransformationStep } from '../Transformation';
import Token from '../Token';

export default class Insert implements TransformationStep {
  private offset: number;
  private tokens: Token[];

  constructor(offset: number, tokens: Token[]) {
    this.offset = offset;
    this.tokens = tokens;
  }

  getType(): string {
    return 'Insert';
  }

  getOffset(): number {
    return this.offset;
  }

  getTokens(): Token[] {
    return this.tokens;
  }
}
