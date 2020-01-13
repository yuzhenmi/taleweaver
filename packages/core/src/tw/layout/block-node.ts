import { ILineLayoutNode } from './line-node';
import { ILayoutNode, ILayoutNodeClass, ILayoutPosition, LayoutNode, LayoutPosition } from './node';
import { IPageLayoutNode } from './page-node';
import { ILayoutRect } from './rect';

export interface IBlockLayoutNode extends ILayoutNode<IPageLayoutNode, ILineLayoutNode> {
    convertCoordinatesToOffset(x: number, y: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
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
                    const left = childRect.left;
                    const right = childRect.right;
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
        this.height = undefined;
    }
}
