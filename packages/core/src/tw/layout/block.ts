import { IBoundingBox, ILayoutNode, ILayoutNodeType, IResolveBoundingBoxesResult, LayoutNode } from './node';

export interface ILayoutBlock extends ILayoutNode {}

export class LayoutBlock extends LayoutNode implements ILayoutBlock {
    protected internalHeight?: number;

    constructor(
        renderId: string | null,
        children: ILayoutNode[],
        readonly width: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(renderId, '', children, paddingTop, paddingBottom, paddingLeft, paddingRight);
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

    convertCoordinatesToOffset(x: number, y: number) {
        let offset = 0;
        let cumulatedHeight = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childHeight = child.height;
            if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
                offset += child.convertCoordinatesToOffset(x, 0);
                break;
            }
            offset += child.size;
            cumulatedHeight += childHeight;
        }
        if (offset === this.size) {
            const lastChild = this.lastChild;
            if (lastChild) {
                offset -= lastChild.size;
                offset += lastChild.convertCoordinatesToOffset(x, lastChild.height);
            }
        }
        return offset;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const childResults: IResolveBoundingBoxesResult[] = [];
        const boundingBoxes: IBoundingBox[] = [];
        let cumulatedOffset = 0;
        let cumulatedHeight = 0;
        this.children.forEach((child) => {
            if (cumulatedOffset + child.size > from && cumulatedOffset <= to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const childResult = child.resolveBoundingBoxes(childFrom, childTo);
                childResults.push(childResult);
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
            children: childResults,
        };
    }
}
