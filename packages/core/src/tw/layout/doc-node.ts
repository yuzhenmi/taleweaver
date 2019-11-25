import { ILayoutNode, ILayoutPosition, LayoutNode, LayoutPosition } from 'tw/layout/node';
import { IPageLayoutNode } from 'tw/layout/page-node';

export interface IDocLayoutNode extends ILayoutNode<never, IPageLayoutNode> {}

export abstract class DocLayoutNode extends LayoutNode<never, IPageLayoutNode> implements IDocLayoutNode {
    protected size?: number;

    isRoot() {
        return true;
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

    resolvePosition(offset: number): ILayoutPosition {
        let cumulatedOffset = 0;
        const children = this.getChildren();
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
            const childSize = child.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new LayoutPosition(this, 0, offset);
                const childPosition = child.resolvePosition(offset - cumulatedOffset, 1);
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
