export interface INode<TParent extends INode = INode<any, any>, TChild extends INode = INode<any, any>> {
    getId(): string;
    isRoot(): boolean;
    isLeaf(): boolean;
    setParent(parent: TParent | undefined): void;
    getParent(): TParent | undefined;
    setChildren(children: TChild[]): void;
    replaceChild(child: TChild): void;
    getChildren(): TChild[];
    getFirstChild(): TChild | undefined;
    getLastChild(): TChild | undefined;
    getPreviousSibling(): INode | undefined;
    getNextSibling(): INode | undefined;
    getPreviousSiblingAllowCrossParent(): INode | undefined;
    getNextSiblingAllowCrossParent(): INode | undefined;
    findDescendant(nodeId: string): INode | undefined;
}

export abstract class Node<TParent extends INode, TChild extends INode> implements INode<TParent, TChild> {
    private parent?: TParent;
    private children?: TChild[];

    abstract getId(): string;
    abstract isRoot(): boolean;
    abstract isLeaf(): boolean;

    setParent(parent: TParent | undefined) {
        this.parent = parent;
    }

    getParent() {
        if (this.isRoot()) {
            throw new Error('Getting parent on root node is not allowed.');
        }
        return this.parent;
    }

    setChildren(children: TChild[]) {
        this.children = children;
        children.forEach(child => child.setParent(this));
    }

    replaceChild(child: TChild) {
        const childId = child.getId();
        const index = this.children!.findIndex(c => c.getId() === childId);
        if (index < 0) {
            throw new Error('Child is not found.');
        }
        child.setParent(this);
        this.children![index] = child;
    }

    getChildren() {
        if (this.isLeaf()) {
            throw new Error('Getting children on leaf node is not allowed.');
        }
        return this.children!;
    }

    getFirstChild() {
        const children = this.children!;
        if (children.length === 0) {
            return undefined;
        }
        return children[0];
    }

    getLastChild() {
        const children = this.children!;
        if (children.length === 0) {
            return undefined;
        }
        return children[children.length - 1];
    }

    getPreviousSibling(): INode | undefined {
        if (this.isRoot()) {
            throw new Error('Getting previous sibling on root node is not allowed.');
        }
        const siblings = this.getParent()!.getChildren();
        const ownIndex = siblings.indexOf(this);
        if (ownIndex < 0) {
            throw new Error('Error getting previous sibling, node is not found in parent.');
        }
        if (ownIndex === 0) {
            return undefined;
        }
        return siblings[ownIndex - 1];
    }

    getNextSibling(): INode | undefined {
        if (this.isRoot()) {
            throw new Error('Getting next sibling on root node is not allowed.');
        }
        const siblings = this.getParent()!.getChildren();
        const ownIndex = siblings.indexOf(this);
        if (ownIndex < 0) {
            throw new Error('Error getting next sibling, node is not found in parent.');
        }
        if (ownIndex === siblings.length - 1) {
            return undefined;
        }
        return siblings[ownIndex + 1];
    }

    getPreviousSiblingAllowCrossParent(): INode | undefined {
        if (this.isRoot()) {
            throw new Error('Getting previous sibling on root node is not allowed.');
        }
        const previousSibling = this.getPreviousSibling();
        if (previousSibling) {
            return previousSibling;
        }
        const parentNode = this.getParent()!;
        if (parentNode.isRoot()) {
            return undefined;
        }
        const parentPreviousSibling = parentNode.getPreviousSiblingAllowCrossParent();
        if (!parentPreviousSibling) {
            return undefined;
        }
        return parentPreviousSibling.getLastChild();
    }

    getNextSiblingAllowCrossParent(): INode | undefined {
        if (this.isRoot()) {
            throw new Error('Getting next sibling on root node is not allowed.');
        }
        const nextSibling = this.getNextSibling();
        if (nextSibling) {
            return nextSibling;
        }
        const parentNode = this.getParent()!;
        if (parentNode.isRoot()) {
            return undefined;
        }
        const parentNextSibling = this.getParent()!.getNextSiblingAllowCrossParent();
        if (!parentNextSibling) {
            return undefined;
        }
        return parentNextSibling.getFirstChild();
    }

    findDescendant(id: string): INode | undefined {
        if (this.getId() === id) {
            return this as INode;
        }
        if (this.isLeaf()) {
            return undefined;
        }
        const children = this.children!;
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n]!;
            const result = child.findDescendant(id);
            if (result) {
                return result;
            }
        }
        return undefined;
    }
}
