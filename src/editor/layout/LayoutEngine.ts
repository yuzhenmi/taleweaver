import Config from '../Config';
import DocRenderNode from '../render/DocRenderNode';
import BlockRenderNode from '../render/BlockRenderNode';
import DocLayout from './DocLayout';
import PageLayout from './PageLayout';
import BlockBox from './BlockBox';
import LineBox from './LineBox';
import AtomicBox from './AtomicBox';

interface BlockOfAtomicBoxes {
  blockRenderNode: BlockRenderNode;
  atomicBoxes: AtomicBox[];
}

interface BlockOfLineBoxes {
  blockRenderNode: BlockRenderNode;
  lineBoxes: LineBox[];
}

export default class LayoutEngine {
  protected config: Config;
  protected docRenderNode: DocRenderNode;
  protected docLayout: DocLayout;
  
  constructor(config: Config, docRenderNode: DocRenderNode) {
    this.config = config;
    this.docRenderNode = docRenderNode;
    this.docLayout = new DocLayout();
    this.reflow();
  }

  getDocLayout(): DocLayout {
    return this.docLayout;
  }

  protected reflow() {
    // Iterate through render doc to build atomic boxes,
    // grouped by blocks
    const blocksOfAtomicBoxes: BlockOfAtomicBoxes[] = [];
    this.docRenderNode.getChildren().forEach(blockRenderNode => {
      const blockOfAtomicBoxes: BlockOfAtomicBoxes = {
        blockRenderNode,
        atomicBoxes: [],
      };
      blockRenderNode.getChildren().forEach(inlineRenderNode => {
        inlineRenderNode.getChildren().map(atomicRenderNode => {
          const atomicBoxBuider = this.config.getAtomicBoxBuilder(atomicRenderNode.getType());
          const atomicBox = atomicBoxBuider.build(atomicRenderNode);
          blockOfAtomicBoxes.atomicBoxes.push(atomicBox);
        });
      });
      blocksOfAtomicBoxes.push(blockOfAtomicBoxes);
    });

    // Build line boxes
    const blocksOfLineBoxes: BlockOfLineBoxes[] = [];
    blocksOfAtomicBoxes.forEach(blockOfAtomicBoxes => {
      const { blockRenderNode, atomicBoxes } = blockOfAtomicBoxes;
      const blockOfLineBoxes: BlockOfLineBoxes = {
        blockRenderNode,
        lineBoxes: [],
      };
      const lineBoxBuilder = this.config.getLineBoxBuilder(blockRenderNode.getType());
      let lineBox = lineBoxBuilder.build(blockRenderNode);
      let offset = 0;
      atomicBoxes.forEach(atomicBox => {
        lineBox.insertChild(atomicBox, offset);
        offset += 1;
      });
      blockOfLineBoxes.lineBoxes.push(lineBox);
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
    let offset = 0;
    blockBoxes.forEach(blockBox => {
      pageLayout.insertChild(blockBox, offset);
      offset += 1;
    });
    pageLayouts.push(pageLayout);

    // Update doc layout
    this.docLayout.getPageLayouts().length = 0;
    pageLayouts.forEach(pageLayout => {
      this.docLayout.insertPageLayout(pageLayout);
    });
  }
}
