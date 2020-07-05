import { IBoundingBox, IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { IResolvedPosition } from './position';

export interface ILayoutBlock extends ILayoutNode {}

export class LayoutBlock extends LayoutNode implements ILayoutBlock {
    protected internalHeight?: number;

    constructor(
        modelId: string | null,
        renderId: string | null,
        children: ILayoutNode[],
        readonly width: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(modelId, renderId, '', children, paddingTop, paddingBottom, paddingLeft, paddingRight);
    }

    get type(): ILayoutNodeType {
        return 'block';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight = this.children.reduce((height, child) => height + child.height, this.paddingVertical);
        }
        return this.internalHeight;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        let cumulatedHeight = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childHeight = child.height;
            if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
                return [n, ...child.convertCoordinatesToPosition(x, 0)];
            }
            cumulatedHeight += childHeight;
        }
        const lastChild = this.lastChild!;
        return [this.children.length - 1, ...lastChild.convertCoordinatesToPosition(x, lastChild.height)];
    }

    resolveBoundingBoxes(from: IResolvedPosition | null, to: IResolvedPosition | null): IResolvedBoundingBoxes {
        const fromOffset = from ? this.boundOffset(from[0].offset) : 0;
        const toOffset = to ? this.boundOffset(to[0].offset) : this.contentLength;
        if (fromOffset > toOffset) {
            throw new Error('Invalid range.');
        }
        const resolvedChildren: IResolvedBoundingBoxes[] = [];
        const boundingBoxes: IBoundingBox[] = [];
        let cumulatedHeight = 0;
        for (let n = fromOffset; n <= toOffset; n++) {
            const child = this.children.at(n);
            const resolvedChild = child.resolveBoundingBoxes(
                from && n === fromOffset ? from.slice(1) : null,
                to && n === toOffset ? to.slice(1) : null,
            );
            resolvedChildren.push(resolvedChild);
            resolvedChild.boundingBoxes.forEach((boundingBox) => {
                boundingBoxes.push({
                    from: [n, ...boundingBox.from],
                    to: [n, ...boundingBox.to],
                    width: boundingBox.width,
                    height: boundingBox.height,
                    top: cumulatedHeight + this.paddingTop + boundingBox.top,
                    bottom: this.height - this.paddingTop - cumulatedHeight - child.height + boundingBox.bottom,
                    left: boundingBox.left,
                    right: boundingBox.right,
                });
            });
            cumulatedHeight += child.height;
        }
        return {
            node: this,
            boundingBoxes,
            children: resolvedChildren,
        };
    }
}
