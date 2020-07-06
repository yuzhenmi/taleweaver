import { INode } from './node';

export interface IDidUpdateNodeListEvent {}

export interface INodeList<TNode extends INode<TNode>> {
    readonly length: number;

    at(index: number): TNode;
    indexOf(node: TNode): number;
    forEach(callbackFn: (value: TNode, index?: number) => void): void;
    map: <T>(callbackFn: (value: TNode) => T) => T[];
    reduce: <T>(callbackFn: (previousValue: T, currentValue: TNode) => T, initialValue: T) => T;
    filter: (callbackfn: (value: TNode, index: number, array: TNode[]) => any) => TNode[];
    slice: (start?: number, end?: number) => TNode[];
    find: (callbackFn: (value: TNode, index: number) => boolean) => TNode | undefined;
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

    forEach(callbackFn: (value: TNode, index?: number) => void) {
        return this.nodes.forEach(callbackFn);
    }

    map<T>(callbackFn: (value: TNode) => T) {
        return this.nodes.map(callbackFn);
    }

    reduce<T>(callbackFn: (previousValue: T, currentValue: TNode) => T, initialValue: T) {
        return this.nodes.reduce(callbackFn, initialValue);
    }

    filter(callbackfn: (value: TNode, index: number, array: TNode[]) => any) {
        return this.nodes.filter(callbackfn);
    }

    slice(start?: number, end?: number) {
        return this.nodes.slice(start, end);
    }

    find(callbackFn: (value: TNode, index: number) => boolean) {
        return this.nodes.find(callbackFn);
    }
}
