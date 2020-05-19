import { IBoundingBox, ILayoutNode, ILayoutNodeType, IResolveBoundingBoxesResult, LayoutNode } from './node';

export interface ILayoutPage extends ILayoutNode {
    readonly contentHeight: number;
}

export class LayoutPage extends LayoutNode implements ILayoutPage {
    protected internalContentHeight?: number;

    constructor(
        readonly width: number,
        readonly height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(null, '', paddingTop, paddingBottom, paddingLeft, paddingRight);
        this.onDidUpdateNode(() => {
            this.internalContentHeight = undefined;
        });
    }

    get type(): ILayoutNodeType {
        return 'page';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get contentHeight() {
        if (this.internalContentHeight === undefined) {
            this.internalContentHeight = this.children.reduce(
                (contentHeight, child) => contentHeight + child.height,
                0,
            );
        }
        return this.internalContentHeight;
    }

    convertCoordinatesToOffset(x: number, y: number) {
        let offset = 0;
        let cumulatedHeight = 0;
        const contentX = Math.min(Math.max(x - this.paddingLeft, 0), this.width - this.paddingRight);
        const contentY = Math.min(Math.max(y - this.paddingTop, 0), this.height - this.paddingBottom);
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childHeight = child.height;
            if (contentY >= cumulatedHeight && contentY <= cumulatedHeight + childHeight) {
                offset += child.convertCoordinatesToOffset(contentX, contentY - cumulatedHeight);
            }
            offset += child.size;
            cumulatedHeight += childHeight;
        }
        if (offset === this.size) {
            const lastChild = this.lastChild;
            if (lastChild) {
                offset -= lastChild.size;
                offset += lastChild.convertCoordinatesToOffset(contentX, lastChild.height);
            }
        }
        if (offset === this.size) {
            offset--;
        }
        return offset;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to >= this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const childResults: IResolveBoundingBoxesResult[] = [];
        const boundingBoxes: IBoundingBox[] = [];
        let cumulatedOffset = 0;
        let cumulatedHeight = 0;
        this.children.forEach((child) => {
            if (cumulatedOffset + child.size > from && cumulatedOffset < to) {
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