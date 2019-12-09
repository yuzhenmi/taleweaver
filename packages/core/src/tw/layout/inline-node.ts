import { ILayoutNode, ILayoutPosition, LayoutNode, LayoutPosition } from 'tw/layout/node';
import { IAtomicLayoutNode } from './atomic-node';
import { ILineLayoutNode } from './line-node';

export interface IInlineLayoutNode extends ILayoutNode<ILineLayoutNode, IAtomicLayoutNode> {
    getTailTrimmedWidth(): number;
    clone(): IInlineLayoutNode;
}

export abstract class InlineLayoutNode extends LayoutNode<ILineLayoutNode, IAtomicLayoutNode>
    implements IInlineLayoutNode {
    abstract clone(): IInlineLayoutNode;

    protected size?: number;
    protected width?: number;
    protected height?: number;
    protected tailTrimmedWidth?: number;

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
        return this.size;
    }

    getWidth() {
        if (this.width === undefined) {
            this.width = this.getChildren().reduce(
                (width, child) => width + child.getWidth(),
                this.getHorizontalPaddng(),
            );
        }
        return this.width;
    }

    getHeight() {
        if (this.height === undefined) {
            this.height =
                this.getChildren().reduce((height, child) => Math.max(height, child.getHeight()), 0) +
                this.getVerticalPaddng();
        }
        return this.height;
    }

    getTailTrimmedWidth() {
        if (this.tailTrimmedWidth === undefined) {
            const lastChild = this.getLastChild();
            if (lastChild) {
                this.tailTrimmedWidth = this.getWidth() - lastChild.getWidth() + lastChild.getTailTrimmedWidth();
            } else {
                this.tailTrimmedWidth = 0;
            }
        }
        return this.tailTrimmedWidth;
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
        this.width = undefined;
        this.height = undefined;
        this.tailTrimmedWidth = undefined;
    }
}
