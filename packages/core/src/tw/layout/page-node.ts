import { IBlockLayoutNode } from 'tw/layout/block-node';
import { IDocLayoutNode } from 'tw/layout/doc-node';
import { ILayoutNode, ILayoutPosition, LayoutNode, LayoutPosition } from 'tw/layout/node';
import { generateId } from 'tw/util/id';

export interface IPageLayoutNode extends ILayoutNode<IDocLayoutNode, IBlockLayoutNode> {
    getContentHeight(): number;
    isFlowed(): boolean;
    markAsFlowed(): void;
    clone(): IPageLayoutNode;
}

export class PageLayoutNode extends LayoutNode<IDocLayoutNode, IBlockLayoutNode> implements IPageLayoutNode {
    protected size?: number;
    protected contentHeight?: number;
    protected flowed = false;

    constructor(
        protected width: number,
        protected height: number,
        protected paddingTop: number,
        protected paddingBottom: number,
        protected paddingLeft: number,
        protected paddingRight: number,
    ) {
        super('', generateId());
    }

    getPartId() {
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
        const children = this.getChildren();
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
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

    clearOwnCache() {
        this.size = undefined;
        this.contentHeight = undefined;
        this.flowed = false;
    }

    clone() {
        return new PageLayoutNode(
            this.width,
            this.height,
            this.paddingTop,
            this.paddingBottom,
            this.paddingLeft,
            this.paddingRight,
        );
    }
}
