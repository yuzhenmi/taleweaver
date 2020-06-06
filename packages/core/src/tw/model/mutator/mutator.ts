import { IModelNode } from '../node';

export abstract class Mutator<TState> {
    protected ran = false;
    protected inProgress = false;

    protected abstract next(): void;

    protected abstract readonly state: TState;

    run() {
        if (this.ran) {
            throw new Error('Already ran.');
        }
        this.inProgress = true;
        while (this.inProgress) {
            this.next();
        }
        this.ran = true;
    }

    protected joinNodeWithNextSibling(node: IModelNode<any>) {
        const nextSibling = node.nextSibling;
        if (!nextSibling) {
            return;
        }
        if (!node.canJoin(nextSibling)) {
            return;
        }
        node.replace(0, node.children.length, [...node.children.slice(), ...nextSibling.children.slice()]);
        const parent = node.parent!;
        parent.replace(
            0,
            parent.children.length,
            parent.children.filter((child) => child !== nextSibling),
        );
    }

    protected joinNodeWithPreviousSibling(node: IModelNode<any>) {
        const previousSibling = node.previousSibling;
        if (!previousSibling) {
            return;
        }
        if (!previousSibling.canJoin(node)) {
            return;
        }
        node.replace(0, node.children.length, [...previousSibling.children.slice(), ...node.children.slice()]);
        const parent = node.parent!;
        parent.replace(
            0,
            parent.children.length,
            parent.children.filter((child) => child !== node),
        );
    }
}
