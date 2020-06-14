import { IMapping } from '../../model/change/mapping';
import { ICursorState } from '../service';
import { CursorChange } from './change';

export class MoveTo extends CursorChange {
    constructor(protected anchor: number | null, protected head: number | null) {
        super();
    }

    apply(currentState: ICursorState, mappings: IMapping[]) {
        const oldAnchor = currentState.anchor;
        const oldHead = currentState.head;
        return {
            newState: {
                anchor: this.map(this.anchor, mappings) ?? oldAnchor,
                head: this.map(this.head, mappings) ?? oldHead,
                leftLock: currentState.leftLock,
            },
            change: this,
            reverseChange: new MoveTo(oldAnchor, oldHead),
        };
    }

    map(offset: number | null, mappings: IMapping[]) {
        if (offset === null) {
            return null;
        }
        return mappings.reduce((newOffset, mapping) => mapping.map(newOffset), offset);
    }
}
