import { generateId } from '../util/id';
import { IBoundingBox, IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';

export interface ILayoutPage extends ILayoutNode {
    readonly contentHeight: number;
}

export class LayoutPage extends LayoutNode implements ILayoutPage {
    protected internalContentHeight?: number;

    constructor(
        children: ILayoutNode[],
        readonly width: number,
        readonly height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(generateId(), null, '', children, paddingTop, paddingBottom, paddingLeft, paddingRight);
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

    convertCoordinatesToPosition(x: number, y: number) {
        let offset = 0;
        let cumulatedHeight = 0;
        const contentX = Math.min(Math.max(x - this.paddingLeft, 0), this.innerWidth);
        const contentY = Math.min(Math.max(y - this.paddingTop, 0), this.innerHeight);
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childHeight = child.height;
            if (contentY >= cumulatedHeight && contentY <= cumulatedHeight + childHeight) {
                offset += child.convertCoordinatesToPosition(contentX, contentY - cumulatedHeight);
                break;
            }
            offset += child.size;
            cumulatedHeight += childHeight;
        }
        if (offset === this.size) {
            const lastChild = this.lastChild;
            if (lastChild) {
                offset -= lastChild.size;
                offset += lastChild.convertCoordinatesToPosition(contentX, lastChild.height);
            }
        }
        return offset;
    }

    resolveBoundingBoxes(from: number, to: number): IResolvedBoundingBoxes {
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
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                resolvedChildren.push(resolvedChild);
                resolvedChild.boundingBoxes.forEach((boundingBox) => {
                    boundingBoxes.push({
                        from: cumulatedOffset + childFrom,
                        to: cumulatedOffset + childTo,
                        width: boundingBox.width,
                        height: boundingBox.height,
                        top: cumulatedHeight + this.paddingTop + boundingBox.top,
                        bottom: this.height - this.paddingTop - cumulatedHeight - child.height + boundingBox.bottom,
                        left: boundingBox.left + this.paddingLeft,
                        right: boundingBox.right + this.paddingRight,
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
