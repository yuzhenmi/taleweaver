import Editor from '../Editor';
import AtomicRenderNode from '../render/AtomicRenderNode';
import BlockRenderNode from '../render/BlockRenderNode';
import DocRenderNode from '../render/DocRenderNode';
import InlineRenderNode from '../render/InlineRenderNode';
import { AnyRenderNode } from '../render/RenderNode';
import AtomicNode from './AtomicLayoutNode';
import BlockNode from './BlockLayoutNode';
import DocNode from './DocLayoutNode';
import InlineNode from './InlineLayoutNode';
import { AnyLayoutNode } from './LayoutNode';
import LineNode from './LineLayoutNode';
import PageNode from './PageLayoutNode';

export default class LayoutTreeBuilder {
    protected editor: Editor;
    protected rootRenderNode: AnyRenderNode;
    protected rootNode?: AnyLayoutNode;
    protected ran: boolean = false;

    constructor(editor: Editor, rootRenderNode: AnyRenderNode) {
        this.editor = editor;
        this.rootRenderNode = rootRenderNode;
    }

    run() {
        if (!this.ran) {
            this.build();
        }
        return this.rootNode!;
    }

    protected build() {
        this.ran = true;
        this.rootNode = this.buildNode(this.rootRenderNode);
    }

    protected buildNode(renderNode: AnyRenderNode) {
        if (renderNode instanceof DocRenderNode) {
            return this.buildDocNode(renderNode);
        }
        if (renderNode instanceof BlockRenderNode) {
            return this.buildBlockNode(renderNode);
        }
        if (renderNode instanceof InlineRenderNode) {
            return this.buildInlineNode(renderNode);
        }
        if (renderNode instanceof AtomicRenderNode) {
            return this.buildAtomicNode(renderNode);
        }
        throw new Error('Error building layout node, unexpected render node type.');
    }

    protected buildDocNode(docRenderNode: DocRenderNode) {
        const DocNodeClass = this.getLayoutNodeClass(docRenderNode.getType());
        const docNode = new DocNodeClass(this.editor, docRenderNode);
        if (!(docNode instanceof DocNode)) {
            throw new Error('Error building layout node, doc render node did not map to doc layout node.');
        }
        const pageNode = new PageNode(this.editor);
        docRenderNode.getChildNodes().forEach(blockRenderNode => {
            const blockNode = this.buildBlockNode(blockRenderNode);
            pageNode.appendChild(blockNode);
        });
        return docNode;
    }

    protected buildBlockNode(blockRenderNode: BlockRenderNode) {
        const BlockNodeClass = this.getLayoutNodeClass(blockRenderNode.getType());
        const blockNode = new BlockNodeClass(this.editor, blockRenderNode);
        if (!(blockNode instanceof BlockNode)) {
            throw new Error('Error building layout node, block render node did not map to block layout node.');
        }
        const lineNode = new LineNode(this.editor);
        blockNode.appendChild(lineNode);
        blockRenderNode.getChildNodes().forEach(inlineRenderNode => {
            const inlineNode = this.buildInlineNode(inlineRenderNode);
            lineNode.appendChild(inlineNode);
        });
        return blockNode;
    }

    protected buildInlineNode(inlineRenderNode: InlineRenderNode) {
        const InlineNodeClass = this.getLayoutNodeClass(inlineRenderNode.getType());
        const inlineNode = new InlineNodeClass(this.editor, inlineRenderNode);
        if (!(inlineNode instanceof InlineNode)) {
            throw new Error('Error building layout node, inline render node did not map to inline layout node.');
        }
        inlineRenderNode.getChildNodes().forEach(atomicRenderNode => {
            const atomicNode = this.buildAtomicNode(atomicRenderNode);
            inlineNode.appendChild(atomicNode);
        });
        return inlineNode;
    }

    protected buildAtomicNode(atomicRenderNode: AtomicRenderNode) {
        const AtomicNodeClass = this.getLayoutNodeClass(atomicRenderNode.getType());
        const atomicNode = new AtomicNodeClass(this.editor, atomicRenderNode);
        if (!(atomicNode instanceof AtomicNode)) {
            throw new Error('Error building layout node, atomic render node did not map to atomic layout node.');
        }
        return atomicNode;
    }

    protected getLayoutNodeClass(renderNodeType: string) {
        const nodeConfig = this.editor.getConfig().getNodeConfig();
        return nodeConfig.getLayoutNodeClass(renderNodeType);
    }
}
