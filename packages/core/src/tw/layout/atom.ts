import { IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';

export interface ILayoutAtom extends ILayoutNode {}

export class LayoutAtom extends LayoutNode implements ILayoutAtom {
    constructor(renderId: string, readonly width: number, readonly height: number) {
        super(renderId, renderId, ' ', [], 0, 0, 0, 0);
    }

    get type(): ILayoutNodeType {
        return 'atom';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        if (x < this.innerWidth / 2) {
            return 0;
        }
        return 1;
    }

    resolveBoundingBoxes(from: number, to: number): IResolvedBoundingBoxes {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        return {
            node: this,
            boundingBoxes: [
                {
                    from,
                    to,
                    width: from === to ? 0 : this.innerWidth,
                    height: this.innerHeight,
                    left: from === 0 ? this.paddingLeft : this.paddingLeft + this.innerWidth,
                    right: to === 1 ? this.paddingRight : this.paddingRight + this.innerWidth,
                    top: this.paddingTop,
                    bottom: this.paddingBottom,
                },
            ],
            children: [],
        };
    }
}
