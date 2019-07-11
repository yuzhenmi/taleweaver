export interface Position<N extends Node<any, any>> {
  node: N;
  depth: number;
  offset: number;
  parent?: Position<N>;
  child?: Position<N>;
}

export default abstract class Node<P extends (Node | undefined) = Node<any, any>, C extends (Node | undefined) = Node<any, any>> {
  abstract isRoot(): boolean;
  abstract isLeaf(): boolean;

  protected parent?: P;
  protected children?: C[];

  constructor() {
    if (!this.isLeaf()) {
      this.children = [];
    }
  }

  setParent(parent: P) {
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
    this.children!.push(child);
  }

  insertBefore(child: C, beforeChild: C) {
    if (this.isLeaf()) {
      throw new Error('Inserting on leaf node is not allowed.');
    }
    const beforeChildIndex = this.children!.indexOf(beforeChild);
    if (beforeChildIndex < 0) {
      throw new Error('Error inserting, child to insert before is not found.');
    }
    this.children!.splice(beforeChildIndex, 0, child);
  }

  removeChild(child: C) {
    if (this.isLeaf()) {
      throw new Error('Removing child on leaf node is not allowed.');
    }
    const childIndex = this.children!.indexOf(child);
    if (childIndex < 0) {
      throw new Error('Error removing child, child is not found.');
    }
    this.children!.splice(childIndex, 1);
  }

  getChildren() {
    if (this.isLeaf()) {
      throw new Error('Getting children on leaf node is not allowed.');
    }
    return this.children as C[];
  }

  getPreviousSibling() {
    if (this.isRoot()) {
      throw new Error('Getting previous sibling on root node is not allowed.');
    }
    const siblings = this.parent!.getChildren();
    const ownIndex = siblings.indexOf(this);
    if (ownIndex < 0) {
      throw new Error('Error getting previous sibling, node is not found in parent.');
    }
    if (ownIndex === 0) {
      return null;
    }
    return siblings[ownIndex - 1];
  }

  getNextSibling() {
    if (this.isRoot()) {
      throw new Error('Getting next sibling on root node is not allowed.');
    }
    const siblings = this.parent!.getChildren();
    const ownIndex = siblings.indexOf(this);
    if (ownIndex < 0) {
      throw new Error('Error getting next sibling, node is not found in parent.');
    }
    if (ownIndex === siblings.length - 1) {
      return null;
    }
    return siblings[ownIndex + 1];
  }
}
