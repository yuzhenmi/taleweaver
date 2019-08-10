export type AnyNode = Node<any, any>;

export default abstract class Node<P extends (Node | undefined) = Node<any, any>, C extends (Node | undefined) = Node<any, any>> {
    abstract isRoot(): boolean;
    abstract isLeaf(): boolean;
    abstract getID(): string;

    private parent?: P;
    private childNodes?: C[];

    constructor() {
        if (!this.isLeaf()) {
            this.childNodes = [];
        }
    }

    setParent(parent: P | undefined) {
        this.parent = parent;
    }

    getParent() {
        if (this.isRoot()) {
            throw new Error('Getting parent on root node is not allowed.');
        }
        return this.parent || null;
    }

    appendChild(child: C) {
        if (this.isLeaf()) {
            throw new Error('Appending child on leaf node is not allowed.');
        }
        this.childNodes!.push(child);
        child!.setParent(this);
    }

    insertBefore(child: C, beforeChild: C) {
        if (this.isLeaf()) {
            throw new Error('Inserting on leaf node is not allowed.');
        }
        const beforeChildIndex = this.childNodes!.indexOf(beforeChild);
        if (beforeChildIndex < 0) {
            throw new Error('Error inserting, child to insert before is not found.');
        }
        this.childNodes!.splice(beforeChildIndex, 0, child);
        child!.setParent(this);
    }

    removeChild(child: C) {
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
        return this.childNodes as C[];
    }

    getFirstChild() {
        const childNodes = this.getChildNodes();
        if (childNodes.length === 0) {
            return null;
        }
        return childNodes[0];
    }

    getLastChild() {
        const childNodes = this.getChildNodes();
        if (childNodes.length === 0) {
            return null;
        }
        return childNodes[childNodes.length - 1];
    }

    getPreviousSibling(): this | null {
        if (this.isRoot()) {
            throw new Error('Getting previous sibling on root node is not allowed.');
        }
        const siblings = this.getParent()!.getChildNodes();
        const ownIndex = siblings.indexOf(this);
        if (ownIndex < 0) {
            throw new Error('Error getting previous sibling, node is not found in parent.');
        }
        if (ownIndex === 0) {
            return null;
        }
        return siblings[ownIndex - 1] as any;
    }

    getNextSibling(): this | null {
        if (this.isRoot()) {
            throw new Error('Getting next sibling on root node is not allowed.');
        }
        const siblings = this.getParent()!.getChildNodes();
        const ownIndex = siblings.indexOf(this);
        if (ownIndex < 0) {
            throw new Error('Error getting next sibling, node is not found in parent.');
        }
        if (ownIndex === siblings.length - 1) {
            return null;
        }
        return siblings[ownIndex + 1] as any;
    }

    getPreviousSiblingAllowCrossParent(): this | null {
        if (this.isRoot()) {
            throw new Error('Getting previous sibling on root node is not allowed.');
        }
        const previousSibling = this.getPreviousSibling();
        if (previousSibling) {
            return previousSibling;
        }
        const parentNode = this.getParent()!;
        if (parentNode.isRoot()) {
            return null;
        }
        const parentPreviousSibling = parentNode.getPreviousSiblingAllowCrossParent();
        if (!parentPreviousSibling) {
            return null;
        }
        return parentPreviousSibling.getLastChild()! as any;
    }

    getNextSiblingAllowCrossParent(): this | null {
        if (this.isRoot()) {
            throw new Error('Getting next sibling on root node is not allowed.');
        }
        const nextSibling = this.getNextSibling();
        if (nextSibling) {
            return nextSibling;
        }
        const parentNode = this.getParent()!;
        if (parentNode.isRoot()) {
            return null;
        }
        const parentNextSibling = this.getParent()!.getNextSiblingAllowCrossParent();
        if (!parentNextSibling) {
            return null;
        }
        return parentNextSibling.getFirstChild()! as any;
    }

    findDescendant(id: string): AnyNode | null {
        if (this.getID() === id) {
            return this;
        }
        if (this.isLeaf()) {
            return null;
        }
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n]!;
            const result = childNode.findDescendant(id);
            if (result) {
                return result;
            }
        }
        return null;
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
                    if (childNodes[o]!.getID() === updatedChildNode.getID()) {
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
