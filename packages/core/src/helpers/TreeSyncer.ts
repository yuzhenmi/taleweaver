abstract class TreeSyncer<S, D> {

  syncNodes(srcNode: S, dstNode: D) {
    const srcChildren = this.getSrcNodeChildren(srcNode);
    const dstChildren = this.getDstNodeChildren(dstNode);
    let dstChildOffset = 0;
    for (let n = 0, nn = srcChildren.length; n < nn; n++) {
      const srcChild = srcChildren[n];
      const foundDstChildOffset = this.findSrcNodeInDstNodes(srcChild, dstChildren);
      if (foundDstChildOffset < dstChildOffset) {
        const dstChild = this.insertNode(srcChild, dstNode, dstChildOffset);
        this.syncNodes(srcChild, dstChild);
        dstChildOffset++;
        continue;
      }
      for (let m = dstChildOffset; m < foundDstChildOffset; m++) {
        const dstChild = dstChildren[dstChildOffset];
        this.deleteNode(dstNode, dstChild);
      }
      const dstChild = dstChildren[dstChildOffset];
      dstChildOffset++;
      if (this.updateNode(dstChild, srcChild)) {
        this.syncNodes(srcChild, dstChild);
      }
    }
  }

  abstract getSrcNodeChildren(node: S): S[];

  abstract getDstNodeChildren(node: D): D[];

  abstract findSrcNodeInDstNodes(srcNode: S, dstNodes: D[]): number;

  abstract insertNode(srcNode: S, parent: D, offset: number): D;

  abstract deleteNode(parent: D, node: D): void;

  abstract updateNode(node: D, srcNode: S): boolean;
}

export default TreeSyncer;
