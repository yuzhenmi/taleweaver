import { generateId } from '../util/id';
import { IBlockLayoutNode } from './block-node';
import { IDocLayoutNode } from './doc-node';
import { ILayoutNode, ILayoutNodeClass, ILayoutPosition, LayoutNode, LayoutPosition } from './node';
import { ILayoutRect } from './rect';

export interface IPageLayoutNode extends ILayoutNode<IDocLayoutNode, IBlockLayoutNode> {
    getContentHeight(): number;
    isFlowed(): boolean;
    markAsFlowed(): void;
    convertCoordinatesToOffset(x: number, y: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
    clone(): IPageLayoutNode;
}

export abstract class PageLayoutNode extends LayoutNode<IDocLayoutNode, IBlockLayoutNode> implements IPageLayoutNode {
    abstract clone(): IPageLayoutNode;

    protected size?: number;
    protected contentHeight?: number;
    protected flowed = false;

    constructor(
        protected componentId: string,
        protected width: number,
        protected height: number,
        protected paddingTop: number,
        protected paddingBottom: number,
        protected paddingLeft: number,
        protected paddingRight: number,
    ) {
        super(componentId, generateId());
    }

    getNodeClass(): ILayoutNodeClass {
        return 'page';
    }

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildren().reduce((size, child) => size + child.getSize(), 0);
        }
        return this.size!;
    }

    getWidth() {
        return this.width;
    }

    getHeight() {
        return this.height;
    }

    getPaddingTop() {
        return this.paddingTop;
    }

    getPaddingBottom() {
        return this.paddingBottom;
    }

    getPaddingLeft() {
        return this.paddingLeft;
    }

    getPaddingRight() {
        return this.paddingRight;
    }

    getContentHeight() {
        if (this.contentHeight === undefined) {
            this.contentHeight = this.getChildren().reduce(
                (contentHeight, child) => contentHeight + child.getHeight(),
                0,
            );
        }
        return this.contentHeight;
    }

    isFlowed() {
        return this.flowed;
    }

    markAsFlowed() {
        this.flowed = true;
    }

    resolvePosition(offset: number, depth: number): ILayoutPosition {
        let cumulatedOffset = 0;
        for (let child of this.getChildren()) {
            const childSize = child.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new LayoutPosition(this, depth, offset);
                const childPosition = child.resolvePosition(offset - cumulatedOffset, depth + 1);
                position.setChild(childPosition);
                childPosition.setParent(position);
                return position;
            }
            cumulatedOffset += childSize;
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    convertCoordinatesToOffset(x: number, y: number) {
        let offset = 0;
        let cumulatedHeight = 0;
        const contentX = Math.min(Math.max(x - this.getPaddingLeft(), 0), this.getWidth() - this.getPaddingRight());
        const contentY = Math.min(Math.max(y - this.getPaddingTop(), 0), this.getHeight() - this.getPaddingBottom());
        for (let child of this.getChildren()) {
            const childHeight = child.getHeight();
            if (contentY >= cumulatedHeight && contentY <= cumulatedHeight + childHeight) {
                offset += child.convertCoordinatesToOffset(contentX, contentY - cumulatedHeight);
                break;
            }
            offset += child.getSize();
            cumulatedHeight += childHeight;
        }
        if (offset === this.getSize()) {
            const lastChild = this.getLastChild();
            if (lastChild) {
                offset -= lastChild.getSize();
                offset += lastChild.convertCoordinatesToOffset(contentX, lastChild.getHeight());
            }
        }
        if (offset === this.getSize()) {
            offset--;
        }
        return offset;
    }

    resolveRects(from: number, to: number) {
        const rects: ILayoutRect[] = [];
        let offset = 0;
        let cumulatedHeight = 0;
        this.getChildren().forEach((child, n) => {
            const childHeight = child.getHeight();
            const minChildOffset = 0;
            const maxChildOffset = child.getSize();
            const childFrom = Math.max(from - offset, minChildOffset);
            const childTo = Math.min(to - offset, maxChildOffset);
            if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
                const childRects = child.resolveRects(childFrom, childTo);
                childRects.forEach(childRect => {
                    const width = childRect.width;
                    const height = childRect.height;
                    const paddingTop = this.getPaddingTop();
                    const paddingBottom = this.getPaddingBottom();
                    const paddingLeft = this.getPaddingLeft();
                    const paddingRight = this.getPaddingRight();
                    const left = paddingLeft + childRect.left;
                    const right = paddingRight + childRect.right;
                    const top = cumulatedHeight + paddingTop + childRect.top;
                    const bottom = this.getHeight() - cumulatedHeight - childHeight - childRect.bottom - paddingBottom;
                    rects.push({
                        width,
                        height,
                        left,
                        right,
                        top,
                        bottom,
                        paddingTop: childRect.paddingTop,
                        paddingBottom: childRect.paddingBottom,
                        paddingLeft: childRect.paddingLeft,
                        paddingRight: childRect.paddingRight,
                    });
                });
            }
            offset += child.getSize();
            cumulatedHeight += childHeight;
        });
        return rects;
    }

    clearOwnCache() {
        this.size = undefined;
        this.contentHeight = undefined;
        this.flowed = false;
    }
}
