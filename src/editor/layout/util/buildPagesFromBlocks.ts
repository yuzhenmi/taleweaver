import Block from '../BlockLayout';
import Page from '../PageLayout';

export default function buildPagesFromBlocks(pageWidth: number, pageHeight: number, blocks: Block[]): Page[] {
  const pages: Page[] = [];
  let cumulatedHeight = 0;
  let cumulatedBlocks: Block[] = [];
  blocks.forEach(block => {
    if (cumulatedHeight + block.getHeight() > pageHeight) {
      pages.push(new Page(pageWidth, pageHeight, cumulatedBlocks));
      cumulatedHeight = 0;
      cumulatedBlocks = [];
    }
    cumulatedHeight += block.getHeight();
    cumulatedBlocks.push(block);
  });
  if (cumulatedBlocks.length > 0) {
    pages.push(new Page(pageWidth, pageHeight, cumulatedBlocks));
  }
  return pages;
}
