export interface INode<
    TParent extends INode | undefined = INode<any, any>,
    TChild extends INode | undefined = INode<any, any>
> {
    getId(): string;
    isRoot(): boolean;
    isLeaf(): boolean;
    setParent(parent: TParent | undefined): void;
    appendChild(child: TChild): void;
    insertBefore(child: TChild, before: TChild): void;
    removeChild(child: TChild): void;
    getChildNodes(): TChild[];
    getFirstChild(): TChild | undefined;
    getLastChild(): TChild | undefined;
    getPreviousSibling(): INode | undefined;
    getNextSibling(): INode | undefined;
    getPreviousSiblingAllowCrossParent(): INode | undefined;
    getNextSiblingAllowCrossParent(): INode | undefined;
    findDescendant(nodeId: string): INode | undefined;
    onUpdated(updatedNode: this): void;
}

export abstract class Node<TParent extends INode | undefined, TChild extends INode | undefined>
    implements INode<TParent, TChild> {
    private parent?: TParent;
    private childNodes?: TChild[];

    abstract getId(): string;
    abstract isRoot(): boolean;
    abstract isLeaf(): boolean;

    constructor() {
        if (!this.isLeaf()) {
            this.childNodes = [];
        }
    }

    setParent(parent: TParent | undefined) {
        this.parent = parent;
    }

    getParent() {
        if (this.isRoot()) {
            throw new Error('Getting parent on root node is not allowed.');
        }
        return this.parent;
    }

    appendChild(child: TChild) {
        if (this.isLeaf()) {
            throw new Error('Appending child on leaf node is not allowed.');
        }
        this.childNodes!.push(child);
        child!.setParent(this);
    }

    insertBefore(child: TChild, before: TChild) {
        if (this.isLeaf()) {
            throw new Error('Inserting on leaf node is not allowed.');
        }
        const beforeIndex = this.childNodes!.indexOf(before);
        if (beforeIndex < 0) {
            throw new Error('Error inserting, child to insert before is not found.');
        }
        this.childNodes!.splice(beforeIndex, 0, child);
        child!.setParent(this);
    }

    removeChild(child: TChild) {
        if (this.isLeaf()) {
            throw new Error('Removing child on leaf node is not allowed.');
        }
        const childIndex = this.childNodes!.indexOf(child);
        if (childIndex < 0) {
            throw new Error('Error removing child, child is not found.');
        }
        this.childNodes!.splice(childIndex, 1);
        child!.setParent(undefined);
    }

    getChildNodes() {
        if (this.isLeaf()) {
            throw new Error('Getting childNodes on leaf node is not allowed.');
        }
        return this.childNodes!;
    }

    getFirstChild() {
        const childNodes = this.getChildNodes();
        if (childNodes.length === 0) {
            return undefined;
        }
        return childNodes[0];
    }

    getLastChild() {
        const childNodes = this.getChildNodes();
        if (childNodes.length === 0) {
            return undefined;
        }
        return childNodes[childNodes.length - 1];
    }

    getPreviousSibling(): INode | undefined {
        if (this.isRoot()) {
            throw new Error('Getting previous sibling on root node is not allowed.');
        }
        const siblings = this.getParent()!.getChildNodes();
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
        const siblings = this.getParent()!.getChildNodes();
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
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n]!;
            const result = childNode.findDescendant(id);
            if (result) {
                return result;
            }
        }
        return undefined;
    }

    onUpdated(updatedNode: this) {
        if (!this.isLeaf()) {
            const childNodes = this.childNodes!.slice();
            const updatedChildNodes = updatedNode.childNodes!;
            let m = 0;
            for (let n = 0, nn = updatedChildNodes.length; n < nn; n++) {
                const updatedChildNode = updatedChildNodes[n]!;
                let i = -1;
                for (let o = m, oo = childNodes.length; o < oo; o++) {
                    if (childNodes[o]!.getId() === updatedChildNode.getId()) {
                        i = o;
                        break;
                    }
                }
                if (i >= 0) {
                    while (m < i) {
                        this.removeChild(childNodes[m]);
                        m++;
                    }
                    childNodes[m]!.onUpdated(updatedChildNode);
                    m++;
                } else {
                    if (m < childNodes.length) {
                        this.insertBefore(updatedChildNode, childNodes[m]);
                    } else {
                        this.appendChild(updatedChildNode);
                    }
                }
            }
            while (m < childNodes.length) {
                this.removeChild(childNodes[m]);
                m++;
            }
        }
    }
}
