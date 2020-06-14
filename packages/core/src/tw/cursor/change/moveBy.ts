import { IMapping } from '../../model/change/mapping';
import { IRenderService } from '../../render/service';
import { ICursorState } from '../state';
import { CursorChange, ICursorChangeResult } from './change';
import { MoveTo } from './moveTo';

export class MoveBy extends CursorChange {
    constructor(protected offset: number, protected headOnly: boolean) {
        super();
    }

    map(mapping: IMapping) {
        return this;
    }

    apply(cursorState: ICursorState, renderService: IRenderService): ICursorChangeResult {
        const { anchor, head } = cursorState.cursor;
        const newHead = this.restrictOffsetRange(head + this.offset, renderService);
        cursorState.set(this.headOnly ? anchor : newHead, newHead);
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
