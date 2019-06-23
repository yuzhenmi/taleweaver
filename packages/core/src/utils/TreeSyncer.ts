abstract class TreeSyncer<S, D> {
  protected updatedNodes: Set<D> = new Set();

  syncNodes(srcNode: S, dstNode: D) {
    if (!this.updateNode(dstNode, srcNode)) {
      return false;
    }
    this.updatedNodes.add(dstNode);
    const srcChildren = this.getSrcNodeChildren(srcNode);
    const dstChildren = this.getDstNodeChildren(dstNode);
    let dstChildOffset = 0;
    for (let n = 0, nn = srcChildren.length; n < nn; n++) {
      const srcChild = srcChildren[n];
      const foundDstChildOffset = this.findSrcNodeInDstNodes(srcChild, dstChildren);
      if (foundDstChildOffset < dstChildOffset) {
        const dstChild = this.insertNode(dstNode, srcChild, dstChildOffset);
        dstChildren.splice(dstChildOffset, 0, dstChild);
        this.syncNodes(srcChild, dstChild);
        dstChildOffset++;
        continue;
      }
      for (let m = dstChildOffset; m < foundDstChildOffset; m++) {
        const dstChild = dstChildren[dstChildOffset];
        this.deleteNode(dstNode, dstChild);
        dstChildren.splice(dstChildOffset, 1);
      }
      const dstChild = dstChildren[dstChildOffset];
      this.syncNodes(srcChild, dstChild);
      dstChildOffset++;
    }
    // Delete extra nodes at the end
    for (let n = dstChildOffset, nn = dstChildren.length; n < nn; n++) {
      const dstChild = dstChildren[dstChildOffset];
      this.deleteNode(dstNode, dstChild);
      dstChildren.splice(dstChildOffset, 1);
    }
  }

  getUpdatedNodes() {
    return this.updatedNodes;
  }

  abstract getSrcNodeChildren(node: S): S[];

  abstract getDstNodeChildren(node: D): D[];

  abstract findSrcNodeInDstNodes(srcNode: S, dstNodes: D[]): number;

  abstract insertNode(parent: D, srcNode: S, offset: number): D;

  abstract deleteNode(parent: D, node: D): void;

  abstract updateNode(node: D, srcNode: S): boolean;
}

export default TreeSyncer;
