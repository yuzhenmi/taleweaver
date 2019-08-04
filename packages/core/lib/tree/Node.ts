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

    getPreviousSibling(): this | null {
        if (this.isRoot()) {
            throw new Error('Getting previous sibling on root node is not allowed.');
        }
        const siblings = this.parent!.getChildNodes();
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
        const siblings = this.parent!.getChildNodes();
        const ownIndex = siblings.indexOf(this);
        if (ownIndex < 0) {
            throw new Error('Error getting next sibling, node is not found in parent.');
        }
        if (ownIndex === siblings.length - 1) {
            return null;
        }
        return siblings[ownIndex + 1] as any;
    }

    onUpdated(updatedNode: this) {
        if (!this.isLeaf()) {
            const updatedChildNodes = updatedNode.getChildNodes();
            const childNodes = this.getChildNodes().slice();
            this.getChildNodes().forEach(childNode => {
                this.removeChild(childNode);
            });
            for (let n = 0; n < updatedChildNodes.length; n++) {
                const updatedChildNode = updatedChildNodes[n];
                const childNode = childNodes.find((childNode) =>
                    childNode!.getID() === updatedChildNode!.getID()
                );
                if (childNode) {
                    childNode.onUpdated(updatedChildNode!);
                    this.appendChild(childNode);
                } else {
                    this.appendChild(updatedChildNode);
                }
            }
        }
    };
}
