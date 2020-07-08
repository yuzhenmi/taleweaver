import { IModelNode } from '../model/node';

function indent(units: number, spacesPerUnit = 4) {
    return new Array(units * spacesPerUnit).fill(' ').join('');
}

export function printModelNode(node: IModelNode<any>, indentUnits = 0) {
    const lines = [];
    lines.push(
        `${indent(indentUnits)}${node.componentId}.${node.partId}: ${node.id} ${JSON.stringify(node.attributes)} (${
            node.contentLength
        })`,
    );
    if (node.leaf) {
        lines.push(`${indent(indentUnits + 1)}${node.text}`);
    } else {
        node.children.forEach((child) => {
            lines.push(printModelNode(child, indentUnits + 1));
        });
    }
    return lines.join('\n');
}
