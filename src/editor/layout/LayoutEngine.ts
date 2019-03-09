import Config from '../Config';
import RenderDoc from '../render/RenderDoc';
import RenderBlock from '../render/RenderBlock';
import DocLayout from './DocLayout';
import PageLayout from './PageLayout';
import BlockBox from './BlockBox';
import LineBox from './LineBox';
import InlineBox from './InlineBox';

interface BlockOfInlineBoxes {
  renderBlock: RenderBlock;
  inlineBoxes: InlineBox[];
}

interface BlockOfLineBoxes {
  renderBlock: RenderBlock;
  lineBoxes: LineBox[];
}

export default class LayoutEngine {
  protected config: Config;
  protected renderDoc: RenderDoc;
  protected docLayout: DocLayout;
  
  constructor(config: Config, renderDoc: RenderDoc) {
    this.config = config;
    this.renderDoc = renderDoc;
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
    this.renderDoc.getChildren().forEach(renderBlock => {
      const blockOfInlineBoxes: BlockOfInlineBoxes = {
        renderBlock,
        inlineBoxes: [],
      };
      renderBlock.getChildren().forEach(renderInline => {
        const inlineBoxBuider = this.config.getInlineBoxBuilder(renderInline.getType());
        const inlineBoxes = inlineBoxBuider.build(renderInline);
        blockOfInlineBoxes.inlineBoxes.push(...inlineBoxes);
      });
      blocksOfInlineBoxes.push(blockOfInlineBoxes);
    });

    // Build line boxes
    const blocksOfLineBoxes: BlockOfLineBoxes[] = [];
    blocksOfInlineBoxes.forEach(blockOfInlineBoxes => {
      const { renderBlock, inlineBoxes } = blockOfInlineBoxes;
      const blockOfLineBoxes: BlockOfLineBoxes = {
        renderBlock,
        lineBoxes: [],
      };
      const lineBoxBuilder = this.config.getLineBoxBuilder(renderBlock.getType());
      let lineBox = lineBoxBuilder.build(renderBlock);
      inlineBoxes.forEach(inlineBox => {
        lineBox.insertInlineBox(inlineBox);
      });
      blockOfLineBoxes.lineBoxes.push(lineBox);
      blocksOfLineBoxes.push(blockOfLineBoxes);
    });

    // Build block boxes
    const blockBoxes: BlockBox[] = [];
    blocksOfLineBoxes.forEach(blockOfLineBoxes => {
      const { renderBlock, lineBoxes } = blockOfLineBoxes;
      const blockBoxBuilder = this.config.getBlockBoxBuilder(renderBlock.getType())
      let blockBox = blockBoxBuilder.build(renderBlock);
      lineBoxes.forEach(lineBox => {
        blockBox.insertLineBox(lineBox);
      });
      blockBoxes.push(blockBox);
    });

    // Build page layouts
    const pageLayouts: PageLayout[] = [];
    let pageLayout = new PageLayout();
    blockBoxes.forEach(blockBox => {
      pageLayout.insertBlockBox(blockBox);
    });
    pageLayouts.push(pageLayout);

    // Update doc layout
    this.docLayout.getPageLayouts().length = 0;
    pageLayouts.forEach(pageLayout => {
      this.docLayout.insertPageLayout(pageLayout);
    });
  }
}
