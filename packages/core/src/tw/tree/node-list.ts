import { INode } from './node';

export interface INodeList<TNode extends INode<TNode>> {
    readonly length: number;

    at(index: number): TNode;
    indexOf(node: TNode): number;

    insert(node: TNode): void;
    insertBefore(node: TNode, beforeNode: TNode): void;
    append(node: TNode): void;
    appendAfter(node: TNode, afterNode: TNode): void;
    remove(node: TNode): void;

    apply(nodeList: INodeList<TNode>): void;
}

export class NodeList<TNode extends INode<TNode>> implements INodeList<TNode> {
    constructor(protected nodes: TNode[] = []) {}

    get length() {
        return this.nodes.length;
    }

    at(index: number) {
        if (index < 0 || index >= this.nodes.length) {
            throw new Error(`Index ${index} is out of range.`);
        }
        return this.nodes[index];
    }

    indexOf(node: TNode) {
        return this.nodes.findIndex((n) => n.id === node.id);
    }

    insert(node: TNode) {
        if (this.indexOf(node) >= 0) {
            throw new Error('Node is already part of list.');
        }
        this.nodes.unshift(node);
    }

    insertBefore(node: TNode, beforeNode: TNode) {
        if (this.indexOf(node) >= 0) {
            throw new Error('Node is already part of list.');
        }
        const beforeIndex = this.indexOf(beforeNode);
        if (beforeIndex < 0) {
            throw new Error('Node to insert before is not found.');
        }
        this.nodes.splice(beforeIndex, 0, node);
    }

    append(node: TNode) {
        if (this.indexOf(node) >= 0) {
            throw new Error('Node is already part of list.');
        }
        this.nodes.push(node);
    }

    appendAfter(node: TNode, afterNode: TNode) {
        if (this.indexOf(node) >= 0) {
            throw new Error('Node is already part of list.');
        }
        const afterIndex = this.indexOf(afterNode);
        if (afterIndex < 0) {
            throw new Error('Node to insert after is not found.');
        }
        this.nodes.splice(afterIndex + 1, 0, node);
    }

    remove(node: TNode) {
        const index = this.indexOf(node);
        if (index < 0) {
            throw new Error('Node is not part of list.');
        }
        this.nodes.splice(index, 1);
    }

    apply(nodeList: NodeList<TNode>) {
        const oldNodes = this.nodes.slice();
        let m = 0;
        for (let n = 0, nn = nodeList.length; n < nn; n++) {
            const node = nodeList.at(n);
            let i = -1;
            for (let o = m, oo = oldNodes.length; o < oo; o++) {
                if (oldNodes[o]!.id === node.id) {
                    i = o;
                    break;
                }
            }
            if (i >= 0) {
                while (m < i) {
                    this.remove(oldNodes[m]);
                    m++;
                }
                m++;
            } else {
                if (m < oldNodes.length) {
                    this.insertBefore(node, oldNodes[m]);
                } else {
                    this.append(node);
                }
            }
        }
        while (m < oldNodes.length) {
            this.remove(oldNodes[m]);
            m++;
        }
    }
}
