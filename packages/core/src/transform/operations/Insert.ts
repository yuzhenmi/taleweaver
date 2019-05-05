import Token from '../../token/Token';
import Operation, { OffsetAdjustment } from '../Operation';

export default class Insert extends Operation {
  protected at: number;
  protected tokens: Token[];

  constructor(at: number, tokens: Token[]) {
    super();
    this.at = at;
    this.tokens = tokens;
  }

  getOffsetAdjustment(): OffsetAdjustment {
    return {
      at: this.at,
      delta: this.tokens.length,
    };
  }

  adjustOffsetBy(offsetAdjustment: OffsetAdjustment) {
    if (this.at >= offsetAdjustment.at) {
      this.at += offsetAdjustment.delta;
    }
  }

  getAt(): number {
    return this.at;
  }

  getTokens(): Token[] {
    return this.tokens;
  }
}
