import { ILayoutAtom } from './atom';
import { ILayoutBlock } from './block';
import { ILayoutInline } from './inline';
import { ILayoutLine } from './line';
import { ILayoutNode } from './node';
import { ILayoutPage } from './page';
import { identifyLayoutNodeType } from './utility';

export class NodeBreaker {
    break(node: ILayoutNode) {
        switch (identifyLayoutNodeType(node)) {
            case 'Page':
                return this.breakPageNode(node as ILayoutPage);
            case 'Line':
                return this.breakLineNode(node as ILayoutLine);
            default:
                return undefined;
        }
    }

    protected breakPageNode(node: ILayoutPage) {
        const height = node.innerHeight;
        let cumulatedHeight = 0;
        const blockNodes = node.children;
        for (let n = 0; n < blockNodes.length; n++) {
            const blockNode = blockNodes.at(n);
            if (cumulatedHeight + (blockNode.height - blockNode.paddingBottom) > height) {
                const newPageNode = node.clone();
                for (const blockNodeToMove of node.children.slice(n + 1)) {
                    node.removeChild(blockNodeToMove);
                    newPageNode.appendChild(blockNodeToMove);
                }
                const lastBlockNode = node.lastChild;
                if (lastBlockNode) {
                    if (lastBlockNode.type !== 'block') {
                        throw new Error('Expected block as child of page.');
                    }
                    const newBlockNode = this.breakBlockNode(lastBlockNode as ILayoutBlock, height - cumulatedHeight);
                    if (newBlockNode) {
                        newPageNode.insertChild(newBlockNode);
                    }
                    if (lastBlockNode.children.length === 0) {
                        node.removeChild(lastBlockNode);
                    }
                }
                return newPageNode;
            }
            cumulatedHeight += blockNode.height;
        }
        return undefined;
    }

    protected breakBlockNode(node: ILayoutBlock, height: number) {
        let cumulatedHeight = 0;
        const lineNodes = node.children;
        for (let n = 0; n < lineNodes.length; n++) {
            const lineNode = lineNodes.at(n);
            if (cumulatedHeight + lineNode.height > height) {
                const newBlockNode = node.clone();
                for (const lineNodeToMove of node.children.slice(n + 1)) {
                    node.removeChild(lineNodeToMove);
                    newBlockNode.appendChild(lineNodeToMove);
                }
                return newBlockNode;
            }
            cumulatedHeight += lineNode.height;
        }
        return undefined;
    }

    protected breakLineNode(node: ILayoutLine) {
        const width = node.innerHeight;
        let cumulatedWidth = 0;
        const inlineNodes = node.children;
        for (let n = 0; n < inlineNodes.length; n++) {
            const inlineNode = inlineNodes.at(n) as ILayoutInline;
            if (cumulatedWidth + inlineNode.trimmedWidth > width) {
                const newLineNode = node.clone();
                for (let inlineNodeToMove of node.children.slice(n + 1)) {
                    node.removeChild(inlineNodeToMove);
                    newLineNode.appendChild(inlineNodeToMove);
                }
                const lastInlineNode = node.lastChild as ILayoutInline;
                if (lastInlineNode) {
                    const newInlineNode = this.breakInlineNode(lastInlineNode, width - cumulatedWidth, width);
                    if (newInlineNode) {
                        newLineNode.insertChild(newInlineNode);
                    }
                    if (lastInlineNode.children.length === 0) {
                        node.removeChild(lastInlineNode);
                    }
                }
                return newLineNode;
            }
            cumulatedWidth += inlineNode.width;
        }
        return undefined;
    }

    protected breakInlineNode(node: ILayoutInline, width: number, lineWidth: number) {
        let cumulatedWidth = 0;
        const atomicNodes = node.children;
        for (let n = 0; n < atomicNodes.length; n++) {
            const atomicNode = atomicNodes.at(n);
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

    protected breakAtomicNode(node: ILayoutAtom, width: number) {
        if (node.getTailTrimmedWidth() <= width) {
            return null;
        }
        return node.breakAtWidth(width);
    }
}
