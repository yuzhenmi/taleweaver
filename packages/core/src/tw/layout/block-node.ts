import { ILineLayoutNode } from 'tw/layout/line-node';
import { ILayoutNode, ILayoutPosition, LayoutNode, LayoutPosition } from 'tw/layout/node';
import { IPageLayoutNode } from './page-node';

export interface IBlockLayoutNode extends ILayoutNode<IPageLayoutNode, ILineLayoutNode> {}

export abstract class BlockLayoutNode extends LayoutNode<IPageLayoutNode, ILineLayoutNode> implements IBlockLayoutNode {
    protected size?: number;

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
    }
}
