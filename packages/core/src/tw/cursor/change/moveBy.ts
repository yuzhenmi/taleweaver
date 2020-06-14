import { IMapping } from '../../model/change/mapping';
import { ICursorState } from '../service';
import { CursorChange } from './change';

export class MoveBy extends CursorChange {
    constructor(protected anchorBy: number | null, protected headBy: number | null) {
        super();
    }

    apply(currentState: ICursorState, mappings: IMapping[]) {
        const oldAnchor = currentState.anchor;
        const oldHead = currentState.head;
        return {
            newState: {
                anchor: oldAnchor + this.anchorBy ?? 0,
                head: oldHead + this.headBy ?? 0,
                leftLock: currentState.leftLock,
            },
            change: this,
            reverseChange: new MoveBy(-(this.anchorBy ?? 0), -(this.headBy ?? 0)),
        };
    }
}
