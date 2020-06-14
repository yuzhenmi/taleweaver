import { IMapping } from '../../model/change/mapping';
import { IRenderService } from '../../render/service';
import { ICursorState } from '../state';
import { CursorChange, ICursorChangeResult } from './change';

export class MoveTo extends CursorChange {
    protected anchor: number;

    constructor(protected head: number, anchor?: number) {
        super();
        this.anchor = anchor ?? head;
    }

    map(mapping: IMapping) {
        return new MoveTo(mapping.map(this.head), mapping.map(this.anchor));
    }

    apply(cursorState: ICursorState, renderService: IRenderService): ICursorChangeResult {
        const { anchor, head } = cursorState.cursor;
        cursorState.set(
            this.restrictOffsetRange(this.anchor, renderService),
            this.restrictOffsetRange(this.head, renderService),
        );
        return {
            change: this,
            reverseChange: new MoveTo(head, anchor),
        };
    }

    restrictOffsetRange(offset: number, renderService: IRenderService) {
        if (offset < 0) {
            return 0;
        }
        const docSize = renderService.getDocSize();
        if (offset >= docSize) {
            return docSize - 1;
        }
        return offset;
    }
}
