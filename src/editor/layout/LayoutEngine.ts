import Config from '../Config';
import DocRenderNode from '../render/DocRenderNode';
import BlockRenderNode from '../render/BlockRenderNode';
import DocLayout from './DocLayout';
import PageLayout from './PageLayout';
import BlockBox from './BlockBox';
import LineBox from './LineBox';
import InlineBox from './InlineBox';

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
      // TODO: Wrap lines
      let lineBox = new LineBox(inlineBoxes.reduce((sum, inlineBox) => sum + inlineBox.getSelectableSize(), 0));
      let offset = 0;
      inlineBoxes.forEach(inlineBox => {
        lineBox.insertChild(inlineBox, offset);
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

    // Build doc layout
    pageLayouts.forEach(pageLayout => {
      this.docLayout.insertPageLayout(pageLayout);
    });
  }
}
