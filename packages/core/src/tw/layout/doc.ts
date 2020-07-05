import { IModelPosition } from '../model/position';
import { IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { IResolvedPosition } from './position';

export interface ILayoutDoc extends ILayoutNode {}

export class LayoutDoc extends LayoutNode implements ILayoutDoc {
    constructor(
        modelId: string | null,
        renderId: string | null,
        children: ILayoutNode[],
        readonly width: number,
        readonly height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(modelId, renderId, '', children, paddingTop, paddingBottom, paddingLeft, paddingRight);
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

    convertCoordinatesToPosition(x: number, y: number): IModelPosition {
        throw new Error('Use page to convert coordinates to position.');
    }

    resolveBoundingBoxes(from: IResolvedPosition | null, to: IResolvedPosition | null): IResolvedBoundingBoxes {
        const fromOffset = from ? this.boundOffset(from[0].offset) : 0;
        const toOffset = to ? this.boundOffset(to[0].offset) : this.contentLength;
        if (fromOffset > toOffset) {
            throw new Error('Invalid range.');
        }
        const resolvedChildren: IResolvedBoundingBoxes[] = [];
        for (let n = fromOffset; n <= toOffset; n++) {
            const child = this.children.at(n);
            resolvedChildren.push(
                child.resolveBoundingBoxes(
                    from && n === fromOffset ? from.slice(1) : null,
                    to && n === toOffset ? to.slice(1) : null,
                ),
            );
        }
        return {
            node: this,
            boundingBoxes: [],
            children: resolvedChildren,
        };
    }
}
