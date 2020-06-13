import { ILayoutNode, ILayoutNodeType, IResolveBoundingBoxesResult, LayoutNode } from './node';

export interface ILayoutLine extends ILayoutNode {
    readonly contentWidth: number;
}

export class LayoutLine extends LayoutNode implements ILayoutLine {
    protected internalHeight?: number;
    protected internalContentWidth?: number;

    constructor(children: ILayoutNode[], readonly width: number) {
        super(null, '', children, 0, 0, 0, 0);
    }

    get type(): ILayoutNodeType {
        return 'line';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight =
                this.children.reduce((height, child) => Math.max(height, child.height), 0) + this.paddingVertical;
        }
        return this.internalHeight;
    }

    get contentWidth() {
        if (this.internalContentWidth === undefined) {
            this.internalContentWidth = this.children.reduce((contentWidth, child) => contentWidth + child.width, 0);
        }
        return this.internalContentWidth;
    }

    convertCoordinatesToOffset(x: number, y: number) {
        let offset = 0;
        let cumulatedWidth = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childWidth = child.width;
            if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
                offset += child.convertCoordinatesToOffset(x, 0);
            }
            offset += child.size;
            cumulatedWidth += childWidth;
        }
        if (offset === this.size) {
            return offset - 1;
        }
        return offset;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to >= this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const childResults: IResolveBoundingBoxesResult[] = [];
        let cumulatedOffset = 0;
        let cumulatedWidth = 0;
        let left1: number;
        let left2: number;
        this.children.forEach((child) => {
            if (cumulatedOffset + child.size > from && cumulatedOffset < to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const childResult = child.resolveBoundingBoxes(childFrom, childTo);
                childResults.push(childResult);
                if (left1 === undefined) {
                    left1 = cumulatedWidth + childResult.boundingBoxes[0].left;
                }
                left2 =
                    cumulatedWidth +
                    childResult.boundingBoxes.reduce((width, boundingBox) => width + boundingBox.width, 0) -
                    childResult.boundingBoxes[childResult.boundingBoxes.length - 1].right;
            }
            cumulatedOffset += child.size;
            cumulatedWidth += child.width;
        });
        return {
            node: this,
            boundingBoxes: [
                {
                    from,
                    to,
                    width: left2! - left1!,
                    height: this.innerHeight,
                    left: this.paddingLeft + left1!,
                    right: this.width - this.paddingLeft - left2!,
                    top: this.paddingTop,
                    bottom: this.paddingBottom,
                },
            ],
            children: childResults,
        };
    }
}
