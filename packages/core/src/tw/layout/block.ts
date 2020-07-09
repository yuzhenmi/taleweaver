import { IRenderPosition } from '../render/position';
import { generateId } from '../util/id';
import { IBoundingBox, IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';

export interface ILayoutBlock extends ILayoutNode {
    readonly needReflow: boolean;

    clearNeedReflow(): void;
}

export class LayoutBlock extends LayoutNode implements ILayoutBlock {
    protected internalHeight?: number;
    protected internalNeedReflow = true;

    constructor(
        renderId: string,
        children: ILayoutNode[],
        readonly width: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(generateId(), renderId, '', children, paddingTop, paddingBottom, paddingLeft, paddingRight);
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

    get needReflow() {
        return this.internalNeedReflow;
    }

    clearNeedReflow() {
        this.internalNeedReflow = false;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        let offset = 0;
        let cumulatedHeight = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childHeight = child.height;
            if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
                offset += child.convertCoordinatesToPosition(x, 0);
                break;
            }
            offset += child.size;
            cumulatedHeight += childHeight;
        }
        if (offset === this.size) {
            const lastChild = this.lastChild;
            if (lastChild) {
                offset -= lastChild.size;
                offset += lastChild.convertCoordinatesToPosition(x, lastChild.height);
            }
        }
        return offset;
    }

    resolveBoundingBoxes(from: IRenderPosition, to: IRenderPosition): IResolvedBoundingBoxes {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const resolvedChildren: IResolvedBoundingBoxes[] = [];
        const boundingBoxes: IBoundingBox[] = [];
        let cumulatedOffset = 0;
        let cumulatedHeight = 0;
        this.children.forEach((child) => {
            if (cumulatedOffset + child.size > from && cumulatedOffset <= to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const childResult = child.resolveBoundingBoxes(childFrom, childTo);
                resolvedChildren.push(childResult);
                childResult.boundingBoxes.forEach((boundingBox) => {
                    boundingBoxes.push({
                        from: cumulatedOffset + childFrom,
                        to: cumulatedOffset + childTo,
                        width: boundingBox.width,
                        height: boundingBox.height,
                        top: cumulatedHeight + this.paddingTop + boundingBox.top,
                        bottom: this.height - this.paddingTop - cumulatedHeight - child.height + boundingBox.bottom,
                        left: boundingBox.left,
                        right: boundingBox.right,
                    });
                });
            }
            cumulatedOffset += child.size;
            cumulatedHeight += child.height;
        });
        return {
            node: this,
            boundingBoxes,
            children: resolvedChildren,
        };
    }
}
