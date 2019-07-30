import Editor from '../Editor';
import LayoutNode, { LayoutPosition } from './LayoutNode';
import LayoutRect from './LayoutRect';
import PageNode from './PageLayoutNode';

type ChildNode = PageNode;

export default class DocLayoutNode extends LayoutNode<never, ChildNode> {
    protected size?: number;

    constructor(editor: Editor) {
        super(editor, 'Doc');
    }

    isRoot() {
        return true;
    }

    isLeaf() {
        return false;
    }

    getType() {
        return 'Doc';
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
        }
        return this.size;
    }

    clearCache() { }

    resolvePosition(offset: number) {
        let cumulatedOffset = 0;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n];
            const childSize = childNode.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position: LayoutPosition = {
                    node: this,
                    depth: 0,
                    offset,
                };
                const childPosition = childNode.resolvePosition(offset - cumulatedOffset, 1);
                position.child = childPosition;
                childPosition.parent = position;
                return position;
            }
            cumulatedOffset += childSize;
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    resolveLayoutRects(from: number, to: number) {
        const layoutRects: LayoutRect[][] = [];
        const childNodes = this.getChildNodes();
        childNodes.forEach(() => {
            layoutRects.push([]);
        });
        let offset = 0;
        for (let n = 0, nn = childNodes.length; n < nn && offset <= to; n++) {
            const childNode = childNodes[n];
            const childSize = childNode.getSize();
            const minChildOffset = 0;
            const maxChildOffset = childSize;
            const childFrom = Math.max(from - offset, minChildOffset);
            const childTo = Math.min(to - offset, maxChildOffset);
            if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
                const childLayoutRects = childNode.resolveLayoutRects(childFrom, childTo);
                childLayoutRects.forEach(childLayoutRect => {
                    layoutRects[n].push(childLayoutRect);
                });
            }
            offset += childSize;
        }
        return layoutRects;
    }
}
