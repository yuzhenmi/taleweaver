import { IAtomicLayoutNode } from './atomic-node';
import { IBlockLayoutNode } from './block-node';
import { IInlineLayoutNode } from './inline-node';
import { ILineLayoutNode } from './line-node';
import { ILayoutNode } from './node';
import { IPageLayoutNode } from './page-node';
import { identifyLayoutNodeType } from './utility';

export class NodeBreaker {
    break(node: ILayoutNode) {
        switch (identifyLayoutNodeType(node)) {
            case 'Page':
                return this.breakPageNode(node as IPageLayoutNode);
            case 'Line':
                return this.breakLineNode(node as ILineLayoutNode);
            default:
                return undefined;
        }
    }

    protected breakPageNode(node: IPageLayoutNode) {
        const height = node.getInnerHeight();
        let cumulatedHeight = 0;
        const blockNodes = node.getChildren();
        for (let n = 0; n < blockNodes.length; n++) {
            const blockNode = blockNodes[n];
            if (cumulatedHeight + (blockNode.getHeight() - blockNode.getPaddingBottom()) > height) {
                const newPageNode = node.clone();
                for (let blockNodeToMove of node.getChildren().slice(n + 1)) {
                    node.removeChild(blockNodeToMove);
                    newPageNode.appendChild(blockNodeToMove);
                }
                const lastBlockNode = node.getLastChild();
                if (lastBlockNode) {
                    const newBlockNode = this.breakBlockNode(lastBlockNode, height - cumulatedHeight);
                    if (newBlockNode) {
                        newPageNode.insertChild(newBlockNode);
                    }
                    if (lastBlockNode.getChildren().length === 0) {
                        node.removeChild(lastBlockNode);
                    }
                }
                return newPageNode;
            }
            cumulatedHeight += blockNode.getHeight();
        }
        return undefined;
    }

    protected breakBlockNode(node: IBlockLayoutNode, height: number) {
        let cumulatedHeight = 0;
        const lineNodes = node.getChildren();
        for (let n = 0; n < lineNodes.length; n++) {
            const lineNode = lineNodes[n];
            if (cumulatedHeight + lineNode.getHeight() > height) {
                const newBlockNode = node.clone();
                for (let lineNodeToMove of node.getChildren().slice(n)) {
                    node.removeChild(lineNodeToMove);
                    newBlockNode.appendChild(lineNodeToMove);
                }
                return newBlockNode;
            }
            cumulatedHeight += lineNode.getHeight();
        }
        return undefined;
    }

    protected breakLineNode(node: ILineLayoutNode) {
        const width = node.getInnerWidth();
        let cumulatedWidth = 0;
        const inlineNodes = node.getChildren();
        for (let n = 0; n < inlineNodes.length; n++) {
            const inlineNode = inlineNodes[n];
            if (cumulatedWidth + inlineNode.getTailTrimmedWidth() > width) {
                const newLineNode = node.clone();
                for (let inlineNodeToMove of node.getChildren().slice(n + 1)) {
                    node.removeChild(inlineNodeToMove);
                    newLineNode.appendChild(inlineNodeToMove);
                }
                const lastInlineNode = node.getLastChild();
                if (lastInlineNode) {
                    const newInlineNode = this.breakInlineNode(lastInlineNode, width - cumulatedWidth, width);
                    if (newInlineNode) {
                        newLineNode.insertChild(newInlineNode);
                    }
                    if (lastInlineNode.getChildren().length === 0) {
                        node.removeChild(lastInlineNode);
                    }
                }
                return newLineNode;
            }
            cumulatedWidth += inlineNode.getWidth();
        }
        return undefined;
    }

    protected breakInlineNode(node: IInlineLayoutNode, width: number, lineWidth: number) {
        let cumulatedWidth = 0;
        const atomicNodes = node.getChildren();
        for (let n = 0; n < atomicNodes.length; n++) {
            const atomicNode = atomicNodes[n];
            if (cumulatedWidth + atomicNode.getTailTrimmedWidth() > width) {
                const newInlineNode = node.clone();
                for (let atomicNodeToMove of node.getChildren().slice(n)) {
                    node.removeChild(atomicNodeToMove);
                    newInlineNode.appendChild(atomicNodeToMove);
                }
                const nextAtomicNode = newInlineNode.getFirstChild();
                if (nextAtomicNode) {
                    const newAtomicNode = this.breakAtomicNode(nextAtomicNode, lineWidth);
                    if (newAtomicNode) {
                        newInlineNode.appendChildAfter(newAtomicNode, nextAtomicNode);
                    }
                }
                return newInlineNode;
            }
            cumulatedWidth += atomicNode.getWidth();
        }
        return undefined;
    }

    protected breakAtomicNode(node: IAtomicLayoutNode, width: number) {
        if (node.getTailTrimmedWidth() <= width) {
            return null;
        }
        return node.breakAtWidth(width);
    }
}
