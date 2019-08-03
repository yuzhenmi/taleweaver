import Editor from '../Editor';
import DocNode from './DocRenderNode';
import InlineNode from './InlineRenderNode';
import LineBreakNode from './LineBreakRenderNode';
import RenderNode from './RenderNode';
import RenderPosition from './RenderPosition';

export type ParentNode = DocNode;
export type ChildNode = InlineNode;

export default abstract class BlockRenderNode extends RenderNode<ParentNode, ChildNode> {
    protected lineBreakInlineNode: LineBreakNode;
    protected size?: number;
    protected modelSize?: number;

    constructor(editor: Editor, id: string) {
        super(editor, id);
        this.lineBreakInlineNode = new LineBreakNode(editor, id);
        this.lineBreakInlineNode.setParent(this);
    }

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getChildNodes() {
        const childNodes = super.getChildNodes();
        return [...childNodes, this.lineBreakInlineNode];
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
        }
        return this.size!;
    }

    getModelSize() {
        if (this.modelSize === undefined) {
            this.modelSize = this.getChildNodes().reduce((size, childNode) => size + childNode.getModelSize(), 2);
        }
        return this.modelSize!;
    }

    clearCache() {
        this.size = undefined;
        this.modelSize = undefined;
    }

    convertOffsetToModelOffset(offset: number): number {
        let cumulatedSize = 0;
        let cumulatedModelSize = 1;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n];
            const childSize = childNode.getSize();
            if (cumulatedSize + childSize > offset) {
                return cumulatedModelSize + childNode.convertOffsetToModelOffset(offset - cumulatedSize);
            }
            cumulatedSize += childSize;
            cumulatedModelSize += childNode.getModelSize();
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    resolvePosition(offset: number, depth: number) {
        let cumulatedOffset = 0;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n];
            const childSize = childNode.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new RenderPosition(this, depth, offset);
                const childPosition = childNode.resolvePosition(offset - cumulatedOffset, depth + 1);
                position.setChild(childPosition);
                childPosition.setParent(position);
                return position;
            }
            cumulatedOffset += childSize;
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    onUpdated(updatedNode: BlockRenderNode) {
        if (!this.isLeaf()) {
            const updatedChildNodes = updatedNode.getChildNodes();
            const childNodes = super.getChildNodes().slice();
            this.getChildNodes().forEach(childNode => {
                this.removeChild(childNode);
            });
            for (let n = 0; n < updatedChildNodes.length; n++) {
                const updatedChildNode = updatedChildNodes[n];
                const childNode = childNodes.find((childNode) =>
                    childNode!.getID() === updatedChildNode!.getID()
                );
                if (childNode) {
                    childNode.onUpdated(updatedChildNode!);
                    this.appendChild(childNode);
                } else {
                    this.appendChild(updatedChildNode);
                }
            }
        }
        this.clearCache();
    }
}
