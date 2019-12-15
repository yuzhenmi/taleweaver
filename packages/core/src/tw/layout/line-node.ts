import { IBlockLayoutNode } from 'tw/layout/block-node';
import { IInlineLayoutNode } from 'tw/layout/inline-node';
import { ILayoutNode, ILayoutPosition, LayoutNode, LayoutPosition } from 'tw/layout/node';
import { generateId } from 'tw/util/id';

export interface ILineLayoutNode extends ILayoutNode<IBlockLayoutNode, IInlineLayoutNode> {
    getContentWidth(): number;
    isFlowed(): boolean;
    markAsFlowed(): void;
    clone(): ILineLayoutNode;
}

export class LineLayoutNode extends LayoutNode<IBlockLayoutNode, IInlineLayoutNode> implements ILineLayoutNode {
    protected size?: number;
    protected height?: number;
    protected contentWidth?: number;
    protected flowed = false;

    constructor() {
        super('', generateId());
    }

    getPartId() {
        return 'line';
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
        const parent = this.getParent();
        if (!parent) {
            return 0;
        }
        return parent.getWidth();
    }

    getHeight() {
        if (this.height === undefined) {
            this.height = this.getChildren().reduce(
                (height, child) => Math.max(height, child.getHeight()),
                this.getVerticalPaddng(),
            );
        }
        return this.height;
    }

    getContentWidth() {
        if (this.contentWidth === undefined) {
            this.contentWidth = this.getChildren().reduce((contentWidth, child) => contentWidth + child.getWidth(), 0);
        }
        return this.contentWidth;
    }

    getPaddingTop() {
        return 0;
    }

    getPaddingBottom() {
        return 0;
    }

    getPaddingLeft() {
        return 0;
    }

    getPaddingRight() {
        return 0;
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
        this.height = undefined;
        this.contentWidth = undefined;
        this.flowed = false;
    }

    clone() {
        return new LineLayoutNode();
    }
}