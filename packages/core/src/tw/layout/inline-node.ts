import { IAtomicLayoutNode } from './atomic-node';
import { ILineLayoutNode } from './line-node';
import { ILayoutNode, ILayoutNodeClass, ILayoutPosition, LayoutNode, LayoutPosition } from './node';
import { ILayoutRect } from './rect';

export interface IInlineLayoutNode extends ILayoutNode<ILineLayoutNode, IAtomicLayoutNode> {
    getTailTrimmedWidth(): number;
    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
    clone(): IInlineLayoutNode;
}

export abstract class InlineLayoutNode extends LayoutNode<ILineLayoutNode, IAtomicLayoutNode>
    implements IInlineLayoutNode {
    abstract clone(): IInlineLayoutNode;

    protected size?: number;
    protected width?: number;
    protected height?: number;
    protected tailTrimmedWidth?: number;

    getNodeClass(): ILayoutNodeClass {
        return 'inline';
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

    convertCoordinateToOffset(x: number) {
        let offset = 0;
        let cumulatedWidth = 0;
        for (let child of this.getChildren()) {
            const childWidth = child.getWidth();
            if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
                offset += child.convertCoordinateToOffset(x - cumulatedWidth);
                break;
            }
            offset += child.getSize();
            cumulatedWidth += childWidth;
        }
        return offset;
    }

    resolveRects(from: number, to: number) {
        const rects: ILayoutRect[] = [];
        let offset = 0;
        let cumulatedWidth = 0;
        this.getChildren().forEach((child, n) => {
            const childWidth = child.getWidth();
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
                    const left = cumulatedWidth + childRect.left;
                    const right = this.getWidth() - cumulatedWidth - childRect.right;
                    const top = paddingTop + childRect.top;
                    const bottom = paddingBottom + childRect.bottom;
                    rects.push({
                        width,
                        height,
                        left,
                        right,
                        top,
                        bottom,
                        paddingTop,
                        paddingBottom,
                        paddingLeft: 0,
                        paddingRight: 0,
                    });
                });
            }
            offset += child.getSize();
            cumulatedWidth += childWidth;
        });
        return rects;
    }

    clearOwnCache() {
        this.size = undefined;
        this.width = undefined;
        this.height = undefined;
        this.tailTrimmedWidth = undefined;
    }
}
