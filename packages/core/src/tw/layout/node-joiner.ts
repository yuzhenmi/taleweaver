import { IBlockLayoutNode } from './block-node';
import { IInlineLayoutNode } from './inline-node';
import { ILineLayoutNode } from './line-node';
import { ILayoutNode } from './node';
import { IPageLayoutNode } from './page-node';
import { identifyLayoutNodeType } from './utility';

export class NodeJoiner {
    join(thisNode: ILayoutNode, thatNode: ILayoutNode) {
        if (identifyLayoutNodeType(thisNode) !== identifyLayoutNodeType(thatNode)) {
            throw new Error('Nodes to be joined must be of the same type.');
        }
        switch (identifyLayoutNodeType(thisNode)) {
            case 'Page':
                this.joinPageNodes(thisNode as IPageLayoutNode, thatNode as IPageLayoutNode);
                break;
            case 'Line':
                this.joinLineNodes(thisNode as ILineLayoutNode, thatNode as ILineLayoutNode);
                break;
            default:
        }
    }

    protected joinPageNodes(thisNode: IPageLayoutNode, thatNode: IPageLayoutNode) {
        const thisLastChild = thisNode.getLastChild();
        const thatFirstChild = thatNode.getFirstChild();
        if (thisLastChild && thatFirstChild && thisLastChild.getId() === thatFirstChild.getId()) {
            this.joinBlockNodes(thisLastChild, thatFirstChild);
        }
        thatNode
            .getChildren()
            .slice()
            .forEach(child => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinBlockNodes(thisNode: IBlockLayoutNode, thatNode: IBlockLayoutNode) {
        thatNode
            .getChildren()
            .slice()
            .forEach(child => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinLineNodes(thisNode: ILineLayoutNode, thatNode: ILineLayoutNode) {
        const thisLastChild = thisNode.getLastChild();
        const thatFirstChild = thatNode.getFirstChild();
        if (thisLastChild && thatFirstChild && thisLastChild.getId() === thatFirstChild.getId()) {
            this.joinInlineNodes(thisLastChild, thatFirstChild);
        }
        thatNode
            .getChildren()
            .slice()
            .forEach(child => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinInlineNodes(thisNode: IInlineLayoutNode, thatNode: IInlineLayoutNode) {
        thatNode
            .getChildren()
            .slice()
            .forEach(child => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }
}
