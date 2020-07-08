import { IRenderPosition } from '../render/position';
import { IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';

export interface ILayoutDoc extends ILayoutNode {}

export class LayoutDoc extends LayoutNode implements ILayoutDoc {
    constructor(
        renderId: string,
        children: ILayoutNode[],
        readonly width: number,
        readonly height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(renderId, renderId, '', children, paddingTop, paddingBottom, paddingLeft, paddingRight);
    }

    get type(): ILayoutNodeType {
        return 'doc';
    }

    get root() {
        return true;
    }

    get leaf() {
        return false;
    }

    convertCoordinatesToPosition(x: number, y: number): IRenderPosition {
        throw new Error('Use page to convert coordinates to position.');
    }

    resolveBoundingBoxes(from: IRenderPosition, to: IRenderPosition): IResolvedBoundingBoxes {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const resolvedChildren: IResolvedBoundingBoxes[] = [];
        let cumulatedOffset = 0;
        this.children.forEach((child) => {
            if (cumulatedOffset + child.size > from && cumulatedOffset <= to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                resolvedChildren.push(resolvedChild);
            }
            cumulatedOffset += child.size;
        });
        return {
            node: this,
            boundingBoxes: [],
            children: resolvedChildren,
        };
    }
}
