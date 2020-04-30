import { INode } from './node';

export function getNodeLineage(node: INode<any>) {
    const lineage: INode<any>[] = [];
    let currentNode: INode<any> = node;
    while (true) {
        lineage.unshift(currentNode);
        if (currentNode.root) {
            return lineage;
        }
        currentNode = currentNode.parent!;
    }
}

export function findCommonLineage(node1: INode<any>, node2: INode<any>) {
    const nodeLineage1 = getNodeLineage(node1);
    const nodeLineage2 = getNodeLineage(node2);
    let index = 0;
    while (index < nodeLineage1.length && index < nodeLineage2.length) {
        if (nodeLineage1[index] !== nodeLineage2[index]) {
            break;
        }
        index++;
    }
    if (index === 0) {
        throw new Error('No common lineage found.');
    }
    return nodeLineage1[index - 1];
}
