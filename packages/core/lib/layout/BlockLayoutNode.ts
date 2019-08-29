import LayoutNode from './LayoutNode';
import LayoutPosition from './LayoutPosition';
import Rect from './LayoutRect';
import LineNode from './LineLayoutNode';
import PageNode from './PageLayoutNode';

type ParentNode = PageNode;
type ChildNode = LineNode;

export default abstract class BlockLayoutNode extends LayoutNode<ParentNode, ChildNode> {
    abstract getPaddingTop(): number;
    abstract getPaddingBottom(): number;
    abstract splitAt(offset: number): BlockLayoutNode;
    abstract join(blockNode: this): void;

    protected size?: number;
    protected height?: number;

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getWidth() {
        return this.getParent()!.getInnerWidth();
    }

    getHeight() {
        if (this.height === undefined) {
            this.height = this.getChildNodes().reduce(
                (height, childNode) => height + childNode.getHeight(),
                this.getPaddingTop() + this.getPaddingBottom(),
            );
        }
        return this.height;
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
        }
        return this.size;
    }

    resolvePosition(offset: number, depth: number) {
        let cumulatedOffset = 0;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n];
            const childSize = childNode.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new LayoutPosition(this, depth, offset);
                const childPosition = childNode.resolvePosition(offset - cumulatedOffset, depth + 1);
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
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n];
            const childHeight = childNode.getHeight();
            if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
                offset += childNode.convertCoordinatesToOffset(x);
                break;
            }
            offset += childNode.getSize();
            cumulatedHeight += childHeight;
        }
        return offset;
    }

    resolveRects(from: number, to: number) {
        const rects: Rect[] = [];
        let offset = 0;
        let cumulatedHeight = 0;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn && offset <= to; n++) {
            const childNode = childNodes[n];
            const childHeight = childNode.getHeight();
            const minChildOffset = 0;
            const maxChildOffset = childNode.getSize();
            const childFrom = Math.max(from - offset, minChildOffset);
            const childTo = Math.min(to - offset, maxChildOffset);
            if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
                const childRects = childNode.resolveRects(childFrom, childTo);
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
            offset += childNode.getSize();
            cumulatedHeight += childHeight;
        }
        return rects;
    }

    clearCache() {
        this.size = undefined;
        this.height = undefined;
    }
}
