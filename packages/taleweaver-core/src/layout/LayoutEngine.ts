import Config from '../Config';
import DocRenderNode from '../render/DocRenderNode';
import BlockRenderNode from '../render/BlockRenderNode';
import DocLayout from './DocLayout';
import PageLayout from './PageLayout';
import BlockBox from './BlockBox';
import LineBox from './LineBox';
import InlineBox from './InlineBox';

export type OnReflowedSubscriber = () => void;

interface BlockOfInlineBoxes {
  blockRenderNode: BlockRenderNode;
  inlineBoxes: InlineBox[];
}

interface BlockOfLineBoxes {
  blockRenderNode: BlockRenderNode;
  lineBoxes: LineBox[];
}

export default class LayoutEngine {
  protected config: Config;
  protected docRenderNode: DocRenderNode;
  protected docLayout: DocLayout;
  protected onReflowedSubscribers: OnReflowedSubscriber[];
  
  constructor(config: Config, docRenderNode: DocRenderNode) {
    this.config = config;
    this.docRenderNode = docRenderNode;
    this.docLayout = new DocLayout();
    this.onReflowedSubscribers = [];
    this.reflow();
  }

  subscribeOnReflowed(subscriber: OnReflowedSubscriber) {
    this.onReflowedSubscribers.push(subscriber);
  }

  getDocLayout(): DocLayout {
    return this.docLayout;
  }

  protected reflow() {
    // Iterate through render doc to build inline boxes,
    // grouped by blocks
    const blocksOfInlineBoxes: BlockOfInlineBoxes[] = [];
    this.docRenderNode.getChildren().forEach(blockRenderNode => {
      const blockOfInlineBoxes: BlockOfInlineBoxes = {
        blockRenderNode,
        inlineBoxes: [],
      };
      blockRenderNode.getChildren().forEach(inlineRenderNode => {
        const inlineBoxBuilder = this.config.getInlineBoxBuilder(inlineRenderNode.getType());
        const inlineBox = inlineBoxBuilder.build(inlineRenderNode);
        blockOfInlineBoxes.inlineBoxes.push(inlineBox);
      });
      blocksOfInlineBoxes.push(blockOfInlineBoxes);
    });

    // Build line boxes
    const blocksOfLineBoxes: BlockOfLineBoxes[] = [];
    blocksOfInlineBoxes.forEach(blockOfInlineBoxes => {
      const { blockRenderNode, inlineBoxes } = blockOfInlineBoxes;
      const blockOfLineBoxes: BlockOfLineBoxes = {
        blockRenderNode,
        lineBoxes: [],
      };
      let lineBox = new LineBox();
      let accumulatedLineWidth = 0;
      let inlineBoxOffset = 0;
      inlineBoxes.forEach(inlineBox => {
        let currentInlineBox = inlineBox;
        let atomicBoxOffset = 0;
        while (atomicBoxOffset < currentInlineBox.getChildren().length) {
          const atomicBox = currentInlineBox.getChildren()[atomicBoxOffset];
          const atomicBoxWidth = atomicBox.getWidth();
          if (accumulatedLineWidth + atomicBoxWidth > 680) {
            // Wrap line, cut inline box if applicable
            if (atomicBoxOffset > 0) {
              const newInlineBox = currentInlineBox.cutAt(atomicBoxOffset);
              lineBox.insertChild(currentInlineBox, inlineBoxOffset);
              inlineBoxOffset += 1;
              currentInlineBox = newInlineBox;
              atomicBoxOffset = 0;
            }
            blockOfLineBoxes.lineBoxes.push(lineBox);
            lineBox = new LineBox();
            accumulatedLineWidth = 0;
          }
          accumulatedLineWidth += atomicBoxWidth;
          atomicBoxOffset += 1;
        }
        lineBox.insertChild(currentInlineBox, inlineBoxOffset);
        inlineBoxOffset += 1;
      });
      if (lineBox.getChildren().length > 0) {
        blockOfLineBoxes.lineBoxes.push(lineBox);
      }
      blocksOfLineBoxes.push(blockOfLineBoxes);
    });

    // Build block boxes
    const blockBoxes: BlockBox[] = [];
    blocksOfLineBoxes.forEach(blockOfLineBoxes => {
      const { blockRenderNode, lineBoxes } = blockOfLineBoxes;
      const blockBoxBuilder = this.config.getBlockBoxBuilder(blockRenderNode.getType())
      let blockBox = blockBoxBuilder.build(blockRenderNode);
      let offset = 0;
      lineBoxes.forEach(lineBox => {
        blockBox.insertChild(lineBox, offset);
        offset += 1;
      });
      blockBoxes.push(blockBox);
    });

    // Build page layouts
    const pageLayouts: PageLayout[] = [];
    let pageLayout = new PageLayout();
    let accumulatedPageHeight = 0;
    let blockBoxOffset = 0;
    blockBoxes.forEach(blockBox => {
      let currentBlockBox = blockBox;
      let lineBoxOffset = 0;
      while (lineBoxOffset < currentBlockBox.getChildren().length) {
        const lineBox = currentBlockBox.getChildren()[lineBoxOffset];
        const lineBoxHeight = lineBox.getHeight();
        if (accumulatedPageHeight + lineBoxHeight > 880) {
          // Wrap line, cut inline box if applicable
          if (lineBoxOffset > 0) {
            const newBlockBox = currentBlockBox.cutAt(lineBoxOffset);
            pageLayout.insertChild(currentBlockBox, lineBoxOffset);
            lineBoxOffset += 1;
            currentBlockBox = newBlockBox;
            lineBoxOffset = 0;
          }
          pageLayouts.push(pageLayout);
          pageLayout = new PageLayout();
          accumulatedPageHeight = 0;
        }
        accumulatedPageHeight += lineBoxHeight;
        lineBoxOffset += 1;
      }
      pageLayout.insertChild(blockBox, blockBoxOffset);
      blockBoxOffset += 1;
    });
    pageLayouts.push(pageLayout);

    // Build doc layout
    let pageOffset = 0;
    pageLayouts.forEach(pageLayout => {
      this.docLayout.insertChild(pageLayout, pageOffset);
      pageOffset += 1;
    });

    // Notify subscribers
    this.onReflowedSubscribers.forEach(subscriber => subscriber());
  }
}
