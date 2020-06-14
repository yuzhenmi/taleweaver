import { IMapping } from '../../model/change/mapping';
import { ICursorState } from '../service';

export interface ICursorChange {
    readonly type: 'cursor';

    apply(currentState: ICursorState, mappings: IMapping[]): ICursorChangeResult;
}

export interface ICursorChangeResult {
    readonly newState: ICursorState;
    readonly change: ICursorChange;
    readonly reverseChange: ICursorChange;
}

export abstract class CursorChange implements ICursorChange {
    readonly type = 'cursor';

    abstract apply(currentState: ICursorState, mappings: IMapping[]): ICursorChangeResult;
}
