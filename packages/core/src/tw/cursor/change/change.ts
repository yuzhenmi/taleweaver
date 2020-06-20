import { IMapping } from '../../model/change/mapping';
import { IModelService } from '../../model/service';
import { IRenderService } from '../../render/service';
import { ICursorState } from '../state';

export interface ICursorChange {
    readonly type: 'cursor';

    map(mapping: IMapping): ICursorChange;
    apply(cursorState: ICursorState, modelService: IModelService, renderService: IRenderService): ICursorChangeResult;
}

export interface ICursorChangeResult {
    readonly change: ICursorChange;
    readonly reverseChange: ICursorChange;
}

export abstract class CursorChange implements ICursorChange {
    readonly type = 'cursor';

    abstract map(mapping: IMapping): ICursorChange;
    abstract apply(
        cursorState: ICursorState,
        modelService: IModelService,
        renderService: IRenderService,
    ): ICursorChangeResult;
}
