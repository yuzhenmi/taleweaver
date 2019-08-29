import AtomicNode from './AtomicLayoutNode';
import LayoutNode from './LayoutNode';
import LayoutPosition from './LayoutPosition';
import Rect from './LayoutRect';
import LineNode from './LineLayoutNode';

type ParentNode = LineNode;
type ChildNode = AtomicNode;

export default abstract class InlineLayoutNode extends LayoutNode<ParentNode, ChildNode> {
    abstract getPaddingTop(): number;
    abstract getPaddingBottom(): number;
    abstract splitAt(offset: number): InlineLayoutNode;
    abstract join(inlineNode: this): void;

    protected size?: number;
    protected width?: number;
    protected widthWithoutTrailingWhitespace?: number;
    protected height?: number;

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
        }
        return this.size;
    }

    getWidth() {
        if (this.width === undefined) {
            this.width = this.getChildNodes().reduce(
                (width, childNode) => width + childNode.getWidth(),
                0,
            );
        }
        return this.width;
    }

    getWidthWithoutTrailingWhitespace() {
        if (this.widthWithoutTrailingWhitespace === undefined) {
            const childNodes = this.getChildNodes();
            const lastChildNode = childNodes[childNodes.length - 1];
            this.widthWithoutTrailingWhitespace = this.getWidth() - lastChildNode.getWidth() + lastChildNode.getWidthWithoutTrailingWhitespace();
        }
        return this.widthWithoutTrailingWhitespace;
    }

    getHeight() {
        if (this.height === undefined) {
            this.height = this.getChildNodes().reduce(
                (height, childNode) => Math.max(height, childNode.getHeight()),
                0,
            ) + this.getPaddingTop() + this.getPaddingBottom();
        }
        return this.height;
    }

    clearCache() {
        this.size = undefined;
        this.width = undefined;
        this.widthWithoutTrailingWhitespace = undefined;
        this.height = undefined;
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

    convertCoordinatesToOffset(x: number) {
        let offset = 0;
        let cumulatedWidth = 0;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n];
            const childWidth = childNode.getWidth();
            if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
                offset += childNode.convertCoordinatesToOffset(x - cumulatedWidth);
                break;
            }
            offset += childNode.getSize();
            cumulatedWidth += childWidth;
        }
        return offset;
    }

    resolveRects(from: number, to: number) {
        const rects: Rect[] = [];
        let offset = 0;
        let cumulatedWidth = 0;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn && offset <= to; n++) {
            const childNode = childNodes[n];
            const childWidth = childNode.getWidth();
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
            offset += childNode.getSize();
            cumulatedWidth += childWidth;
        }
        return rects;
    }
}
