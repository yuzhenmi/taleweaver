import Editor from '../Editor';
import generateID from '../utils/generateID';
import BlockNode from './BlockLayoutNode';
import DocNode from './DocLayoutNode';
import LayoutNode from './LayoutNode';
import LayoutPosition from './LayoutPosition';
import Rect from './LayoutRect';

type ParentNode = DocNode;
type ChildNode = BlockNode;

export default class PageLayoutNode extends LayoutNode<ParentNode, ChildNode> {
    protected size?: number;
    protected outerWidth: number;
    protected outerHeight: number;
    protected paddingTop: number;
    protected paddingBottom: number;
    protected paddingLeft: number;
    protected paddingRight: number;

    constructor(editor: Editor) {
        super(editor, generateID());
        const pageConfig = editor.getConfig().getPageConfig();
        this.outerWidth = pageConfig.getPageWidth();
        this.outerHeight = pageConfig.getPageHeight();
        this.paddingTop = pageConfig.getPagePaddingTop();
        this.paddingBottom = pageConfig.getPagePaddingBottom();
        this.paddingLeft = pageConfig.getPagePaddingLeft();
        this.paddingRight = pageConfig.getPagePaddingRight();
    }

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getType() {
        return 'Page';
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
        }
        return this.size;
    }

    getOuterWidth() {
        return this.outerWidth;
    }

    getOuterHeight() {
        return this.outerHeight;
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

    getInnerWidth() {
        return this.outerWidth - this.paddingLeft - this.paddingRight;
    }

    getInnerHeight() {
        return this.outerHeight - this.paddingTop - this.paddingBottom;
    }

    clearCache() { }

    splitAt(offset: number) {
        const newNode = new PageLayoutNode(this.editor);
        while (this.getChildNodes().length > offset) {
            const childNode = this.getChildNodes()[offset];
            this.removeChild(childNode);
            newNode.appendChild(childNode);
        }
        this.clearCache();
        return newNode;
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
        const innerX = Math.min(Math.max(x - this.getPaddingLeft(), 0), this.getOuterWidth() - this.getPaddingRight());
        const innerY = Math.min(Math.max(y - this.getPaddingTop(), 0), this.getOuterHeight() - this.getPaddingBottom());
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n];
            const childHeight = childNode.getHeight();
            if (innerY >= cumulatedHeight && innerY <= cumulatedHeight + childHeight) {
                offset += childNode.convertCoordinatesToOffset(innerX, innerY - cumulatedHeight);
                break;
            }
            offset += childNode.getSize();
            cumulatedHeight += childHeight;
        }
        if (offset === this.getSize()) {
            const lastChild = childNodes[childNodes.length - 1];
            offset -= lastChild.getSize();
            offset += lastChild.convertCoordinatesToOffset(innerX, lastChild.getHeight());
        }
        if (offset === this.getSize()) {
            offset--;
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
                    const paddingLeft = this.getPaddingLeft();
                    const paddingRight = this.getPaddingRight();
                    const left = paddingLeft + childRect.left;
                    const right = paddingRight + childRect.right;
                    const top = cumulatedHeight + paddingTop + childRect.top;
                    const bottom = this.getOuterHeight() - cumulatedHeight - childHeight - childRect.bottom - paddingBottom;
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
}
