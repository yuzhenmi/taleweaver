import Token from '../../state/Token';
import AppliedOperation from '../AppliedOperation';
import Operation, { OffsetAdjustment } from '../Operation';

export default class Delete extends Operation {
    protected from: number;
    protected to: number;

    constructor(from: number, to: number) {
        super();
        this.from = from;
        this.to = to;
    }

    getOffsetAdjustment(): OffsetAdjustment {
        return {
            at: this.to,
            delta: this.from - this.to,
        };
    }

    adjustOffset(adjustments: OffsetAdjustment[]) {
        let from = this.from;
        let to = this.to;
        adjustments.forEach(adjustment => {
            if (from >= adjustment.at) {
                from += adjustment.delta;
            }
            if (to >= adjustment.at) {
                to += adjustment.delta;
            }
        });
        return new Delete(from, to);
    }

    getFrom() {
        return this.from;
    }

    getTo() {
        return this.to;
    }
}

export class AppliedDelete extends AppliedOperation {
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
