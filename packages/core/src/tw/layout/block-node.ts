import { ILineLayoutNode } from './line-node';
import { ILayoutNode, ILayoutNodeClass, ILayoutPosition, LayoutNode, LayoutPosition } from './node';
import { IPageLayoutNode } from './page-node';

export interface IBlockLayoutNode extends ILayoutNode<IPageLayoutNode, ILineLayoutNode> {
    convertCoordinatesToOffset(x: number, y: number): number;
    clone(): IBlockLayoutNode;
}

export abstract class BlockLayoutNode extends LayoutNode<IPageLayoutNode, ILineLayoutNode> implements IBlockLayoutNode {
    abstract clone(): IBlockLayoutNode;

    protected size?: number;
    protected height?: number;

    getNodeClass(): ILayoutNodeClass {
        return 'block';
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
        return parent.getInnerWidth();
    }

    getHeight() {
        if (this.height === undefined) {
            this.height = this.getChildren().reduce(
                (height, child) => height + child.getHeight(),
                this.getVerticalPaddng(),
            );
        }
        return this.height;
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

    convertCoordinatesToOffset(x: number, y: number) {
        let offset = 0;
        let cumulatedHeight = 0;
        for (let child of this.getChildren()) {
            const childHeight = child.getHeight();
            if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
                offset += child.convertCoordinateToOffset(x);
                break;
            }
            offset += child.getSize();
            cumulatedHeight += childHeight;
        }
        return offset;
    }

    clearOwnCache() {
        this.size = undefined;
        this.height = undefined;
    }
}
