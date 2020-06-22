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

    protected joinNodes(node1: IModelNode<any>, node2: IModelNode<any>) {
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
}
