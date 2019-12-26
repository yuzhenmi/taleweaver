export interface INode<TParent extends INode = INode<any, any>, TChild extends INode = INode<any, any>> {
    getId(): string;
    isRoot(): boolean;
    isLeaf(): boolean;
    setParent(parent: TParent | undefined): void;
    getParent(): TParent | undefined;
    insertChild(child: TChild): void;
    insertChildBefore(child: TChild, beforeChild: TChild): void;
    appendChild(child: TChild): void;
    appendChildAfter(child: TChild, afterChild: TChild): void;
    removeChild(child: TChild): void;
    getChildren(): TChild[];
    getFirstChild(): TChild | undefined;
    getLastChild(): TChild | undefined;
    getPreviousSibling(): INode | undefined;
    getNextSibling(): INode | undefined;
    getPreviousSiblingAllowCrossParent(): INode | undefined;
    getNextSiblingAllowCrossParent(): INode | undefined;
    findDescendant(nodeId: string): INode | undefined;
    clearCache(): void;
    onDidUpdate(updatedNode: this): void;
}

export abstract class Node<TParent extends INode, TChild extends INode> implements INode<TParent, TChild> {
    private parent?: TParent;
    private children: TChild[] = [];

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

    insertChild(child: TChild) {
        if (this.isLeaf()) {
            throw new Error('Appending child to leaf node is not allowed.');
        }
        this.children.unshift(child);
        child.setParent(this);
        this.clearCache();
    }

    insertChildBefore(child: TChild, beforeChild: TChild) {
        if (this.isLeaf()) {
            throw new Error('Inserting child to leaf node is not allowed.');
        }
        const beforeChildIndex = this.children.indexOf(beforeChild);
        if (beforeChildIndex < 0) {
            throw new Error('Error inserting, child to insert before is not found.');
        }
        this.children.splice(beforeChildIndex, 0, child);
        child.setParent(this);
        this.clearCache();
    }

    appendChild(child: TChild) {
        if (this.isLeaf()) {
            throw new Error('Appending child to leaf node is not allowed.');
        }
        this.children.push(child);
        child.setParent(this);
        this.clearCache();
    }

    appendChildAfter(child: TChild, afterChild: TChild) {
        if (this.isLeaf()) {
            throw new Error('Inserting child to leaf node is not allowed.');
        }
        const afterChildIndex = this.children.indexOf(afterChild);
        if (afterChildIndex < 0) {
            throw new Error('Error inserting, child to insert after is not found.');
        }
        this.children.splice(afterChildIndex + 1, 0, child);
        child.setParent(this);
        this.clearCache();
    }

    removeChild(child: TChild) {
        if (this.isLeaf()) {
            throw new Error('Removing child from leaf node is not allowed.');
        }
        const childIndex = this.children.indexOf(child);
        if (childIndex < 0) {
            throw new Error('Error removing child, child is not found.');
        }
        this.children.splice(childIndex, 1);
        child!.setParent(undefined);
        this.clearCache();
    }

    getChildren() {
        return this.children;
    }

    getFirstChild() {
        const children = this.getChildren();
        if (children.length === 0) {
            return undefined;
        }
        return children[0];
    }

    getLastChild() {
        const children = this.getChildren();
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
        const parentNode = this.getParent();
        if (!parentNode || parentNode.isRoot()) {
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
        const parentNode = this.getParent();
        if (!parentNode || parentNode.isRoot()) {
            return undefined;
        }
        const parentNextSibling = parentNode.getNextSiblingAllowCrossParent();
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
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children[n]!;
            const result = child.findDescendant(id);
            if (result) {
                return result;
            }
        }
        return undefined;
    }

    clearCache() {
        this.clearOwnCache();
        if (!this.isRoot()) {
            const parent = this.getParent();
            if (parent) {
                parent.clearCache();
            }
        }
    }

    onDidUpdate(updatedNode: this) {
        if (!this.isLeaf()) {
            const children = this.children.slice();
            const updatedChildren = updatedNode.children;
            let m = 0;
            for (let n = 0, nn = updatedChildren.length; n < nn; n++) {
                const updatedChild = updatedChildren[n]!;
                let i = -1;
                for (let o = m, oo = children.length; o < oo; o++) {
                    if (children[o]!.getId() === updatedChild.getId()) {
                        i = o;
                        break;
                    }
                }
                if (i >= 0) {
                    while (m < i) {
                        this.removeChild(children[m]);
                        m++;
                    }
                    children[m]!.onDidUpdate(updatedChild);
                    m++;
                } else {
                    if (m < children.length) {
                        this.insertChildBefore(updatedChild, children[m]);
                    } else {
                        this.appendChild(updatedChild);
                    }
                }
            }
            while (m < children.length) {
                this.removeChild(children[m]);
                m++;
            }
        }
    }

    protected clearOwnCache() {}
}
