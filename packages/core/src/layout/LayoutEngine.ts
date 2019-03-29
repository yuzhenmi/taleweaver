import Config from '../Config';
import RenderNode from '../render/RenderNode';
import DocRenderNode from '../render/DocRenderNode';
import BlockRenderNode from '../render/BlockRenderNode';
import LayoutNode from './LayoutNode';
import Box from './Box';
import DocBox from './DocBox';
import PageBox from './PageBox';
import BlockBox from './BlockBox';
import LineBox from './LineBox';
import InlineBox from './InlineBox';

function propagateVersionToAncestors(layoutNode: LayoutNode) {
  let currentNode = layoutNode;
  let parentNode: LayoutNode;
  while (!(currentNode instanceof DocBox)) {
    parentNode = currentNode.getParent();
    if (parentNode.getVersion() >= currentNode.getVersion()) {
      break;
    }
    parentNode.setVersion(currentNode.getVersion());
    currentNode = parentNode;
  }
}

abstract class StackElementOperation {
  
  abstract shiftOffset(delta: number): void;
}

class StackElementInsertChildOperation extends StackElementOperation {
  protected offset: number;
  protected child: Box;

  constructor(offset: number, child: Box) {
    super();
    this.offset = offset;
    this.child = child;
  }

  shiftOffset(delta: number) {
    this.offset += delta;
  }

  getOffset(): number {
    return this.offset;
  }

  getChild(): Box {
    return this.child;
  }
}

class StackElementDeleteChildrenOperation extends StackElementOperation {
  protected fromOffset: number;
  protected toOffset: number;

  constructor(fromOffset: number, toOffset: number) {
    super();
    this.fromOffset = fromOffset;
    this.toOffset = toOffset;
  }

  shiftOffset(delta: number) {
    this.fromOffset += delta;
    this.toOffset += delta;
  }

  getFromOffset(): number {
    return this.fromOffset;
  }

  getToOffset(): number {
    return this.toOffset;
  }
}

class StackElementReplaceChildOperation extends StackElementOperation {
  protected offset: number;
  protected child: Box;

  constructor(offset: number, child: Box) {
    super();
    this.offset = offset;
    this.child = child;
  }

  shiftOffset(delta: number) {
    this.offset += delta;
  }

  getOffset(): number {
    return this.offset;
  }

  getChild(): Box {
    return this.child;
  }
}

class StackElement {
  protected renderNodes: RenderNode[];
  protected iteratorOffset: number;
  protected box: Box;
  protected children: Box[];
  protected invertedChildrenMap: Map<string, [number, number]>;
  protected childIteratorOffset: number;
  protected operationsBuffer: StackElementOperation[];
  protected operationsBufferFlushed: boolean;
  protected lineBoxesToReflow: LineBox[];
  protected pageBoxesToReflow: PageBox[];

  constructor(renderNodes: RenderNode[], box: Box) {
    this.renderNodes = renderNodes;
    this.box = box;
    this.iteratorOffset = -1;
    this.invertedChildrenMap = new Map();
    if (box instanceof DocBox) {
      this.children = this.getDocBoxChildren(box);
    } else if (box instanceof BlockBox) {
      this.children = this.getBlockBoxChildren(box);
    } else {
      this.children = [];
    }
    let child: Box;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      child = this.children[n];
      const childRenderNodeID = child.getRenderNodeID();
      const from = n;
      while (n + 1 < nn && this.children[n + 1].getRenderNodeID() === childRenderNodeID) {
        n++;
      }
      const to = n;
      this.invertedChildrenMap.set(childRenderNodeID, [from, to]);
    }
    this.childIteratorOffset = 0;
    this.operationsBuffer = [];
    this.operationsBufferFlushed = false;
    this.lineBoxesToReflow = [];
    this.pageBoxesToReflow = [];
  }

  iterate(): RenderNode | undefined {
    this.iteratorOffset += 1;
    if (this.iteratorOffset < this.renderNodes.length) {
      return this.renderNodes[this.iteratorOffset];
    }
    return undefined;
  }

  getBox(): Box {
    return this.box;
  }

  findChild(childID: string): [number, number] {
    const offsetRange = this.invertedChildrenMap.get(childID);
    if (offsetRange === undefined) {
      return [-1, -1];
    }
    return offsetRange;
  }

  getChildAt(offset: number): Box {
    if (offset < this.childIteratorOffset) {
      throw new Error(`Cannot get child at offset ${offset}, child iterator offset is already at ${this.childIteratorOffset}.`);
    }
    if (offset < 0 || offset > this.children.length - 1) {
      throw new Error(`Child offset ${offset} is out of valid range 0-${this.children.length - 1}.`);
    }
    return this.children[offset];
  }

  insertChild(child: Box) {
    if (this.operationsBufferFlushed) {
      throw new Error('Cannot append more operations after flushing.');
    }
    const operation = new StackElementInsertChildOperation(this.childIteratorOffset, child);
    this.operationsBuffer.push(operation);
  }

  deleteChildrenTo(offset: number) {
    if (this.operationsBufferFlushed) {
      throw new Error('Cannot append more child operations after flushing.');
    }
    if (offset < this.childIteratorOffset) {
      throw new Error(`Cannot delete children to offset ${offset}, iterator offset is already at ${this.childIteratorOffset}.`);
    }
    this.childIteratorOffset = offset;
    if (offset === this.childIteratorOffset) {
      return;
    }
    const operation = new StackElementDeleteChildrenOperation(this.childIteratorOffset, offset - 1);
    this.operationsBuffer.push(operation);
  }

  replaceChild(child: Box) {
    if (this.operationsBufferFlushed) {
      throw new Error('Cannot append more child operations after flushing.');
    }
    const operation = new StackElementReplaceChildOperation(this.childIteratorOffset, child);
    this.operationsBuffer.push(operation);
  }

  flushOperationsBuffer() {
    if (this.operationsBuffer.length > 0) {
      const box = this.box;
      let operation: StackElementOperation;
      for (let n = 0, nn = this.operationsBuffer.length; n < nn; n++) {
        let delta: number;
        operation = this.operationsBuffer[n];
        if (operation instanceof StackElementInsertChildOperation) {
          if (box instanceof DocBox) {
            delta = this.insertBlockBoxToDocBox(box, operation.getChild() as BlockBox, operation.getOffset());
          } else if (box instanceof BlockBox) {
            delta = this.insertInlineBoxToBlockBox(box, operation.getChild() as InlineBox, operation.getOffset());
          } else {
            delta = 0;
          }
          propagateVersionToAncestors(operation.getChild());
        } else if (operation instanceof StackElementDeleteChildrenOperation) {
          if (box instanceof DocBox) {
            delta = this.deleteBlockBoxesFromDocBox(box, operation.getFromOffset(), operation.getToOffset());
          } else if (box instanceof BlockBox) {
            delta = this.deleteInlineBoxesFromBlockBox(box, operation.getFromOffset(), operation.getToOffset());
          } else {
            delta = 0;
          }
        } else if (operation instanceof StackElementReplaceChildOperation) {
          if (box instanceof DocBox) {
            const [
              deleteFromOffset,
              deleteToOffset,
            ] = this.invertedChildrenMap.get(operation.getChild().getRenderNodeID())!;
            const deleteDelta = this.deleteBlockBoxesFromDocBox(box, deleteFromOffset, deleteToOffset);
            const insertDelta = this.insertBlockBoxToDocBox(box, operation.getChild() as BlockBox, operation.getOffset());
            delta = deleteDelta + insertDelta;
          } else if (box instanceof BlockBox) {
            const [
              deleteFromOffset,
              deleteToOffset,
            ] = this.invertedChildrenMap.get(operation.getChild().getRenderNodeID())!;
            const deleteDelta = this.deleteInlineBoxesFromBlockBox(box, deleteFromOffset, deleteToOffset);
            const insertDelta = this.insertInlineBoxToBlockBox(box, operation.getChild() as InlineBox, operation.getOffset());
            delta = deleteDelta + insertDelta;
          } else {
            delta = 0;
          }
          propagateVersionToAncestors(operation.getChild());
        } else {
          throw new Error('Unknown operation.');
        }
        if (delta !== 0) {
          for (let m = n; m < nn; m++) {
            this.operationsBuffer[m].shiftOffset(delta);
          }
        }
      }
    }
    this.operationsBufferFlushed = true;
  }

  getLineBoxesToReflow(): LineBox[] {
    return this.lineBoxesToReflow;
  }

  getPageBoxesToReflow(): PageBox[] {
    return this.pageBoxesToReflow;
  }

  protected getDocBoxChildren(docBox: DocBox): BlockBox[] {
    const children: BlockBox[] = [];
    docBox.getChildren().forEach(pageBox => {
      pageBox.getChildren().forEach(blockBox => {
        children.push(blockBox);
      });
    });
    return children;
  }

  protected getBlockBoxChildren(blockBox: BlockBox): InlineBox[] {
    const children: InlineBox[] = [];
    blockBox.getChildren().forEach(lineBox => {
      lineBox.getChildren().forEach(inlineBox => {
        children.push(inlineBox);
      });
    });
    return children;
  }

  protected insertBlockBoxToDocBox(docBox: DocBox, blockBox: BlockBox, offset: number): number {
    if (docBox.getChildren().length === 0) {
      const pageBox = new PageBox(docBox.getWidth(), docBox.getHeight(), docBox.getPadding());
      pageBox.setParent(docBox);
      docBox.insertChild(pageBox, 0);
    }
    const pageBoxes = docBox.getChildren();
    let cumulatedOffset = 0;
    let delta = 0;
    for (let m = 0, mm = pageBoxes.length; m < mm; m++) {
      const pageBox = pageBoxes[m];
      if (this.pageBoxesToReflow.length === 0 || this.pageBoxesToReflow[this.pageBoxesToReflow.length - 1] !== pageBox) {
        this.pageBoxesToReflow.push(pageBox);
      }
      const pageBoxChildrenLength = pageBox.getChildren().length;
      if (cumulatedOffset + pageBoxChildrenLength >= offset) {
        pageBox.insertChild(blockBox, offset - cumulatedOffset);
        blockBox.setParent(pageBox);
        delta = 1;
        break;
      }
      cumulatedOffset += pageBoxChildrenLength;
    }
    return delta;
  }

  protected insertInlineBoxToBlockBox(blockBox: BlockBox, inlineBox: InlineBox, offset: number): number {
    if (blockBox.getChildren().length === 0) {
      const lineBox = new LineBox(blockBox.getWidth());
      lineBox.setParent(blockBox);
      blockBox.insertChild(lineBox, 0);
    }
    const lineBoxes = blockBox.getChildren();
    let cumulatedOffset = 0;
    let delta = 0;
    for (let m = 0, mm = lineBoxes.length; m < mm; m++) {
      const lineBox = lineBoxes[m];
      if (this.lineBoxesToReflow.length === 0 || this.lineBoxesToReflow[this.lineBoxesToReflow.length - 1] !== lineBox) {
        this.lineBoxesToReflow.push(lineBox);
      }
      const lineBoxChildrenLength = lineBox.getChildren().length;
      if (cumulatedOffset + lineBoxChildrenLength >= offset) {
        lineBox.insertChild(inlineBox, offset - cumulatedOffset);
        inlineBox.setParent(lineBox);
        delta = 1;
        break;
      }
      cumulatedOffset += lineBoxChildrenLength;
    }
    return delta;
  }

  protected deleteBlockBoxesFromDocBox(docBox: DocBox, fromOffset: number, toOffset: number): number {
    const pageBoxes = docBox.getChildren();
    let cumulatedOffset = 0;
    let pageBox: PageBox;
    for (let m = 0, mm = pageBoxes.length; m < mm; m++) {
      pageBox = pageBoxes[m];
      const pageBoxChildrenLength =  pageBox.getChildren().length;
      const childFromOffset = Math.max(fromOffset - cumulatedOffset, 0);
      const childToOffset = Math.min(toOffset + 1 - cumulatedOffset, pageBoxChildrenLength);
      if (childFromOffset < childToOffset) {
        const childrenToDelete = pageBox.getChildren().slice(childFromOffset, childToOffset + 1);
        for (let o = 0, oo = childrenToDelete.length; o < oo; o++) {
          pageBox.deleteChild(childrenToDelete[o]);
        }
        if (this.pageBoxesToReflow.length === 0 || this.pageBoxesToReflow[this.pageBoxesToReflow.length - 1] !== pageBox) {
          this.pageBoxesToReflow.push(pageBox);
        }
        return 0 - childrenToDelete.length;
      }
      cumulatedOffset += pageBoxChildrenLength;
    }
    return 0;
  }

  protected deleteInlineBoxesFromBlockBox(blockBox: BlockBox, fromOffset: number, toOffset: number): number {
    const lineBoxes = blockBox.getChildren();
    let cumulatedOffset = 0;
    let lineBox: LineBox;
    for (let m = 0, mm = lineBoxes.length; m < mm; m++) {
      lineBox = lineBoxes[m];
      const lineBoxChildrenLength =  lineBox.getChildren().length;
      const childFromOffset = Math.max(fromOffset - cumulatedOffset, 0);
      const childToOffset = Math.min(toOffset + 1 - cumulatedOffset, lineBoxChildrenLength);
      if (childFromOffset < childToOffset) {
        const childrenToDelete = lineBox.getChildren().slice(childFromOffset, childToOffset + 1);
        for (let o = 0, oo = childrenToDelete.length; o < oo; o++) {
          lineBox.deleteChild(childrenToDelete[o]);
        }
        if (this.lineBoxesToReflow.length === 0 || this.lineBoxesToReflow[this.lineBoxesToReflow.length - 1] !== lineBox) {
          this.lineBoxesToReflow.push(lineBox);
        }
        return 0 - childrenToDelete.length;
      }
      cumulatedOffset += lineBoxChildrenLength;
    }
    return 0;
  }
}

class Stack {
  protected elements: StackElement[];

  constructor() {
    this.elements = [];
  }

  push(element: StackElement) {
    this.elements.push(element);
  }

  pop(): StackElement | undefined {
    return this.elements.pop();
  }

  peek(): StackElement | undefined {
    return this.elements[this.elements.length - 1];
  }
}

export default class LayoutEngine {
  protected config: Config;
  protected docRenderNode: DocRenderNode;
  protected docBox: DocBox;
  protected stack: Stack;
  protected lineBoxesToReflow: LineBox[];
  protected pageBoxesToReflow: PageBox[];
  protected ran: boolean;
  protected ranVersion: number;
  
  constructor(config: Config, docRenderNode: DocRenderNode) {
    this.config = config;
    this.docRenderNode = docRenderNode;
    this.docBox = new DocBox(docRenderNode.getID(), docRenderNode.getWidth(), docRenderNode.getHeight(), docRenderNode.getPadding());
    this.stack = new Stack();
    this.lineBoxesToReflow = [];
    this.pageBoxesToReflow = [];
    this.ran = false;
    this.ranVersion = -1;
    this.docRenderNode.subscribeOnUpdated(() => {
      this.run();
    });
  }

  getDocBox(): DocBox {
    if (!this.ran) {
      this.run();
    }
    return this.docBox;
  }

  protected run() {
    this.stack.push(new StackElement(this.docRenderNode.getChildren(), this.docBox));
    while (this.iterate()) {}
    this.flushLineReflowOperationsBuffer();
    this.flushPageReflowOperationsBuffer();
    this.ranVersion = this.docRenderNode.getVersion();
    this.ran = true;
    this.docBox.onUpdated();
  }

  protected iterate(): boolean {
    const lastStackElement = this.stack.peek();
    if (!lastStackElement) {
      return false;
    }
    const renderNode = lastStackElement.iterate();
    if (!renderNode) {
      this.closeBox();
      return this.iterate();
    }
    if (renderNode.getVersion() <= this.ranVersion) {
      return this.iterate();
    }
    this.newBox(renderNode);
    return true;
  }

  protected newBox(renderNode: RenderNode) {
    const lastStackElement = this.stack.peek();
    if (lastStackElement === undefined) {
      throw new Error('Unexpected end of layout encountered.');
    }
    const offset = lastStackElement.findChild(renderNode.getID());
    const boxBuilder = this.config.getBoxBuilder(renderNode.getType());
    const box = boxBuilder.build(renderNode);
    box.setVersion(this.getNextVersion());
    if (offset[0] < 0 || offset[1] < 0) {
      lastStackElement.insertChild(box);
    } else {
      lastStackElement.deleteChildrenTo(offset[1]);
      const originalBoxes: Box[] = [];
      for (let n = offset[0], nn = offset[1]; n < nn; n++) {
        originalBoxes.push(lastStackElement.getChildAt(n));
      }
      let childOffset = 0;
      originalBoxes.forEach(originalBox => {
        originalBox.getChildren().forEach(child => {
          box.insertChild(child, childOffset);
        });
      });
      lastStackElement.replaceChild(box);
    }
    if (renderNode instanceof BlockRenderNode) {
      this.stack.push(new StackElement(renderNode.getChildren(), box));
    }
  }

  protected closeBox() {
    const lastStackElement = this.stack.pop();
    if (lastStackElement === undefined) {
      throw new Error('Unexpected end of render doc encountered.');
    }
    lastStackElement.flushOperationsBuffer();
    this.lineBoxesToReflow.push(...lastStackElement.getLineBoxesToReflow());
    this.pageBoxesToReflow.push(...lastStackElement.getPageBoxesToReflow());
  }

  protected flushLineReflowOperationsBuffer() {
    this.lineBoxesToReflow.forEach(lineBox => {
      this.reflowLineBox(lineBox);
    });
    this.lineBoxesToReflow = [];
  }

  protected flushPageReflowOperationsBuffer() {
    this.pageBoxesToReflow.forEach(pageBox => {
      this.reflowPageBox(pageBox);
    });
    this.pageBoxesToReflow = [];
  }

  protected reflowLineBox(lineBoxToReflow: LineBox) {
    let lineBox = lineBoxToReflow;
    const blockBox = lineBox.getParent();
    if (blockBox.getChildren().indexOf(lineBox) < 0) {
      // Line box was already reflowed and removed when
      // reflowing a previous line, nothing more needs
      // to be done
      return;
    }
    const lineBoxWidth = lineBox.getWidth();
    let cumulatedWidth = 0;
    let n = 0;
    while (true) {
      let inlineBox = lineBox.getChildren()[n];
      if (cumulatedWidth + inlineBox.getWidth() > lineBoxWidth) {
        // With this inline box, the line width limit gets exceeded,
        // so we need to determine where to cleave this inline box
        for (let m = 0; m < inlineBox.getChildren().length; m++) {
          let atomicBox = inlineBox.getChildren()[m];
          if (cumulatedWidth + atomicBox.getWidth() > lineBoxWidth) {
            // With this atomic box, the line width limit gets exceeded,
            // so we cleave the line box after this inline box, and then
            // cleave the inline box before this atomic box
            const newLineBox = lineBox.cleaveAt(n + 1);
            newLineBox.setVersion(this.getNextVersion());
            blockBox.insertChild(newLineBox, blockBox.getChildren().indexOf(lineBox) + 1);
            lineBox = newLineBox;
            n = 0;
            const newInlineBox = inlineBox.cleaveAt(m);
            newInlineBox.setVersion(this.getNextVersion());
            lineBox.insertChild(newInlineBox, lineBox.getChildren().indexOf(inlineBox) + 1);
            inlineBox = newInlineBox;
            m = 0;
            cumulatedWidth = 0;
          }
          cumulatedWidth += atomicBox.getWidth();
        }
      }
      cumulatedWidth += inlineBox.getWidth();
      n++;
      if (n === lineBox.getChildren().length) {
        const lineBoxOffset = blockBox.getChildren().indexOf(lineBox);
        if (lineBoxOffset >= blockBox.getChildren().length - 1) {
          // Last line box in block box reached
          break;
        }
        const nextLineBox = blockBox.getChildren()[lineBoxOffset + 1];
        const nextAtomicBox = nextLineBox.getChildren()[0].getChildren()[0];
        if (cumulatedWidth + nextAtomicBox.getWidth() <= lineBox.getWidth()) {
          // The first atomic box of the next line box can fit on this
          // line box, so we merge the next line box into this line box
          // and continue with reflow
          nextLineBox.getChildren().forEach(nextInlineBox => {
            lineBox.insertChild(nextInlineBox, lineBox.getChildren().length);
          });
          blockBox.deleteChild(nextLineBox);
        }
      }
    }
  }

  protected reflowPageBox(pageBoxToReflow: PageBox) {
    let pageBox = pageBoxToReflow;
    const docBox = pageBox.getParent();
    if (docBox.getChildren().indexOf(pageBox) < 0) {
      // Page box was already reflowed and removed when
      // reflowing a previous page, nothing more needs
      // to be done
      return;
    }
    const pageBoxHeight = pageBox.getInnerHeight();
    let cumulatedHeight = 0;
    let n = 0;
    while (true) {
      let blockBox = pageBox.getChildren()[n];
      if (cumulatedHeight + blockBox.getHeight() > pageBoxHeight) {
        // With this block box, the page height limit gets exceeded,
        // so we need to determine where to cleave this block box
        for (let m = 0; m < blockBox.getChildren().length; m++) {
          let lineBox = blockBox.getChildren()[m];
          if (cumulatedHeight + lineBox.getHeight() > pageBoxHeight) {
            // With this line box, the page height limit gets exceeded,
            // so we cleave the page box after this block box, and then
            // cleave the block box before this line box
            const newPageBox = pageBox.cleaveAt(n + 1);
            newPageBox.setVersion(this.getNextVersion());
            docBox.insertChild(newPageBox, docBox.getChildren().indexOf(pageBox) + 1);
            pageBox = newPageBox;
            n = 0;
            const newBlockBox = blockBox.cleaveAt(m);
            newBlockBox.setVersion(this.getNextVersion());
            pageBox.insertChild(newBlockBox, pageBox.getChildren().indexOf(blockBox) + 1);
            blockBox = newBlockBox;
            m = 0;
            cumulatedHeight = 0;
          }
          cumulatedHeight += lineBox.getHeight();
        }
      }
      cumulatedHeight += blockBox.getHeight();
      n++;
      if (n === pageBox.getChildren().length) {
        const pageBoxOffset = docBox.getChildren().indexOf(pageBox);
        if (pageBoxOffset >= docBox.getChildren().length - 1) {
          // Last page box in doc box reached
          break;
        }
        const nextPageBox = docBox.getChildren()[pageBoxOffset + 1];
        const nextLineBox = nextPageBox.getChildren()[0].getChildren()[0];
        if (cumulatedHeight + nextLineBox.getHeight() <= pageBox.getInnerHeight()) {
          // The first line box of the next page box can fit on this
          // page box, so we merge the next page box into this page box
          // and continue with reflow
          nextPageBox.getChildren().forEach(nextBlockBox => {
            pageBox.insertChild(nextBlockBox, pageBox.getChildren().length);
          });
          docBox.deleteChild(nextPageBox);
        }
      }
    }
  }

  protected getNextVersion(): number {
    return this.docRenderNode.getVersion() + 1;
  }
}
