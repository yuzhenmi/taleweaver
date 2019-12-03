import { ILayoutNode } from 'tw/layout/node';
import { BlockLayoutNode, IBlockLayoutNode } from './block-node';
import { DocLayoutNode, IDocLayoutNode } from './doc-node';
import { IInlineLayoutNode, InlineLayoutNode } from './inline-node';
import { ILineLayoutNode } from './line-node';
import { IPageLayoutNode } from './page-node';

export interface ILayoutFlower {
    flow(node: ILayoutNode): void;
}

export class LayoutFlower implements ILayoutFlower {
    flow(node: ILayoutNode) {
        if (node instanceof DocLayoutNode) {
            this.flowDocNode(node);
        } else if (node instanceof BlockLayoutNode) {
            this.flowBlockNode(node);
        } else if (node instanceof InlineLayoutNode) {
            this.flowInlineNode(node);
        } else {
            throw new Error('Invalid layout node passed to flower.');
        }
    }

    protected flowDocNode(node: IDocLayoutNode) {
        // TODO
    }

    protected flowBlockNode(node: IBlockLayoutNode) {
        const lineNode = node.getFirstChild()!;
        this.flowLineNode(lineNode);
        const pageNode = node.getParent()!;
        this.flowPageNode(pageNode);
    }

    protected flowInlineNode(node: IInlineLayoutNode) {
        const lineNode = node.getParent()!;
        this.flowLineNode(lineNode);
        const pageNode = lineNode.getParent()!.getParent()!;
        this.flowPageNode(pageNode);
    }

    protected flowLineNode(node: ILineLayoutNode) {
        const allowedWidth = node.getWidth();
        const children = node.getChildren();
        let cumulatedWidth = 0;
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
            cumulatedWidth += child.getWidth();
            if (cumulatedWidth > allowedWidth) {
                // TODO: Split line node and flow new splitted line node recursively
                return;
            }
        }
    }

    protected flowPageNode(node: IPageLayoutNode) {
        const allowedHeight = node.getHeight();
        const children = node.getChildren();
        let cumulatedHeight = 0;
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
            cumulatedHeight += child.getHeight();
            if (cumulatedHeight > allowedHeight) {
                // TODO: Split page node and flow new splitted page node recursively
                return;
            }
        }
    }
}
