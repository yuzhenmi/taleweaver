import { IModelNode } from '../../node';

export function join(node1: IModelNode<any>, node2: IModelNode<any>) {
    if (node1.leaf) {
        node1.replace(0, node1.text.length, node1.text + node2.text);
    } else {
        node1.replace(0, node1.children.length, [...node1.children.slice(), ...node2.children.slice()]);
    }
    const parent = node1.parent!;
    parent.replace(
        0,
        parent.children.length,
        parent.children.filter((child) => child !== node2),
    );
}

export function remove(node: IModelNode<any>) {
    const parent = node.parent;
    if (!parent) {
        return;
    }
    const index = parent.children.indexOf(node);
    if (index < 0) {
        return;
    }
    parent.replace(index, index + 1, []);
}

export function compareNodes(node1: IModelNode<any>, node2: IModelNode<any>) {
    if (node1.componentId !== node2.componentId) {
        return false;
    }
    if (node1.partId !== node2.partId) {
        return false;
    }
    if (serializeAttributes(node1.attributes) !== serializeAttributes(node2.attributes)) {
        return false;
    }
    return true;
}

function serializeAttributes(attributes: any) {
    return JSON.stringify(
        Object.keys(attributes)
            .sort()
            .filter((key) => {
                if (!attributes.hasOwnProperty(key)) {
                    return false;
                }
                const value = (attributes as any)[key];
                if (value === undefined || value === null) {
                    return false;
                }
                return true;
            })
            .map((key) => attributes[key]),
    );
}
