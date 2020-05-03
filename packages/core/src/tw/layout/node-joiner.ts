import { ILayoutBlock } from './block';
import { ILayoutInline } from './inline';
import { ILayoutLine } from './line';
import { ILayoutNode } from './node';
import { ILayoutPage } from './page';
import { identifyLayoutNodeType } from './utility';

export class NodeJoiner {
    join(thisNode: ILayoutNode, thatNode: ILayoutNode) {
        if (identifyLayoutNodeType(thisNode) !== identifyLayoutNodeType(thatNode)) {
            throw new Error('Nodes to be joined must be of the same type.');
        }
        switch (identifyLayoutNodeType(thisNode)) {
            case 'Page':
                this.joinPageNodes(thisNode as ILayoutPage, thatNode as ILayoutPage);
                break;
            case 'Line':
                this.joinLineNodes(thisNode as ILayoutLine, thatNode as ILayoutLine);
                break;
            default:
        }
    }

    protected joinPageNodes(thisNode: ILayoutPage, thatNode: ILayoutPage) {
        const thisLastChild = thisNode.getLastChild();
        const thatFirstChild = thatNode.getFirstChild();
        if (thisLastChild && thatFirstChild && thisLastChild.getId() === thatFirstChild.getId()) {
            this.joinBlockNodes(thisLastChild, thatFirstChild);
        }
        thatNode
            .getChildren()
            .slice()
            .forEach((child) => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinBlockNodes(thisNode: ILayoutBlock, thatNode: ILayoutBlock) {
        thatNode
            .getChildren()
            .slice()
            .forEach((child) => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinLineNodes(thisNode: ILayoutLine, thatNode: ILayoutLine) {
        const thisLastChild = thisNode.getLastChild();
        const thatFirstChild = thatNode.getFirstChild();
        if (thisLastChild && thatFirstChild && thisLastChild.getId() === thatFirstChild.getId()) {
            this.joinInlineNodes(thisLastChild, thatFirstChild);
        }
        thatNode
            .getChildren()
            .slice()
            .forEach((child) => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinInlineNodes(thisNode: ILayoutInline, thatNode: ILayoutInline) {
        thatNode
            .getChildren()
            .slice()
            .forEach((child) => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }
}
