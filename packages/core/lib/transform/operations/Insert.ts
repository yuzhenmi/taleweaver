import Token from '../../state/Token';
import AppliedOperation from '../AppliedOperation';
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

    adjustOffset(adjustments: OffsetAdjustment[]) {
        let at = this.at;
        adjustments.forEach(adjustment => {
            if (at >= adjustment.at) {
                at += adjustment.delta;
            }
        });
        return new Insert(at, this.tokens);
    }

    getAt() {
        return this.at;
    }

    getTokens() {
        return this.tokens;
    }
}

export class AppliedInsert extends AppliedOperation {
    protected at: number;
    protected tokens: Token[];

    constructor(at: number, tokens: Token[]) {
        super();
        this.at = at;
        this.tokens = tokens;
    }

    getAt() {
        return this.at;
    }

    getTokens() {
        return this.tokens;
    }
}
