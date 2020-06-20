import { IMapping } from '../../model/change/mapping';
import { IModelService } from '../../model/service';
import { IRenderService } from '../../render/service';
import { ICursorState } from '../state';
import { CursorChange, ICursorChangeResult } from './change';

export class MoveTo extends CursorChange {
    protected modelAnchor: number;

    constructor(protected modelHead: number, modelAnchor?: number) {
        super();
        this.modelAnchor = modelAnchor ?? modelHead;
    }

    map(mapping: IMapping) {
        return new MoveTo(mapping.map(this.modelHead), mapping.map(this.modelAnchor));
    }

    apply(cursorState: ICursorState, modelService: IModelService, renderService: IRenderService): ICursorChangeResult {
        const { anchor, head } = cursorState.cursor;
        const newAnchor = renderService.convertModelOffsetToOffset(
            this.restrictModelOffset(this.modelAnchor, modelService),
        );
        const newHead = renderService.convertModelOffsetToOffset(
            this.restrictModelOffset(this.modelHead, modelService),
        );
        cursorState.set(newAnchor, newHead);
        return {
            change: this,
            reverseChange: new MoveTo(head, anchor),
        };
    }

    restrictModelOffset(modelOffset: number, modelService: IModelService) {
        if (modelOffset < 0) {
            return 0;
        }
        const modelSize = modelService.getRootSize();
        if (modelOffset >= modelSize) {
            return modelSize - 1;
        }
        return modelOffset;
    }
}
