import Editor from '../Editor';
import generateID from '../utils/generateID';
import BlockBox from './BlockLayoutNode';
import InlineNode from './InlineLayoutNode';
import LayoutNode from './LayoutNode';
import LayoutPosition from './LayoutPosition';
import Rect from './LayoutRect';
import mergeRects from './utils/mergeLayoutRects';

type ParentNode = BlockBox;
type ChildNode = InlineNode;

export default class LineLayoutNode extends LayoutNode<ParentNode, ChildNode> {
    protected size?: number;
    protected height?: number;

    constructor(editor: Editor) {
        super(editor, generateID());
    }

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getType() {
        return 'Line';
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
        }
        return this.size;
    }

    getWidth() {
        return this.getParent()!.getWidth();
    }

    getHeight() {
        if (this.height === undefined) {
            this.height = this.getChildNodes().reduce(
                (height, childNode) => Math.max(height, childNode.getHeight()),
                0,
            );
        }
        return this.height;
    }

    clearCache() {
        this.size = undefined;
        this.height = undefined;
    }

    onRenderUpdated() {
        this.clearCache();
    }

    splitAt(offset: number) {
        const newNode = new LineLayoutNode(this.editor);
        while (this.getChildNodes().length > offset) {
            const childNode = this.getChildNodes()[offset];
            this.removeChild(childNode);
            newNode.appendChild(childNode);
        }
        this.clearCache();
        return newNode;
    }

    join(lineNode: LineLayoutNode) {
        const thisLastChild = this.getLastChild();
        const thatFirstChild = lineNode.getFirstChild();
        if (thisLastChild && thatFirstChild && thisLastChild.getID() === thatFirstChild.getID()) {
            thisLastChild.join(thatFirstChild);
            lineNode.removeChild(thatFirstChild);
        }
        const childNodes = lineNode.getChildNodes().slice();
        childNodes.forEach(childNode => {
            lineNode.removeChild(childNode);
            this.appendChild(childNode);
        });
        this.clearCache();
        lineNode.clearCache();
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
        if (offset === this.getSize()) {
            return offset - 1;
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
            if (childFrom <= maxChildOffset && childTo >= minChildOffset && !(childFrom === childTo && childTo === maxChildOffset)) {
                const childRects = childNode.resolveRects(childFrom, childTo);
                childRects.forEach(childRect => {
                    const width = childRect.width;
                    const height = childRect.height;
                    const left = cumulatedWidth + childRect.left;
                    const right = this.getWidth() - cumulatedWidth - childRect.right;
                    const top = childRect.top;
                    const bottom = childRect.bottom;
                    rects.push({
                        width,
                        height,
                        left,
                        right,
                        top,
                        bottom,
                        paddingTop: childRect.paddingTop,
                        paddingBottom: childRect.paddingBottom,
                        paddingLeft: 0,
                        paddingRight: 0,
                    });
                });
            }
            offset += childNode.getSize();
            cumulatedWidth += childWidth;
        }
        mergeRects(rects);
        return rects;
    }
}
