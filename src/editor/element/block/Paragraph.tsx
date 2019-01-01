import React from 'react';
import Document from '../Document';
import Block from './Block';
import Inline from '../inline/Inline';
import BlockLayout from '../../layout/BlockLayout';
import LineLayout from '../../layout/LineLayout';
import BoxLayout from '../../layout/BoxLayout';
import buildLinesFromBoxes from '../../layout/util/buildLinesFromBoxes';
import LineView from '../../view/LineView';
import viewRegistry from '../../view/util/viewRegistry';

export default class Paragraph implements Block {
  private document: Document;
  private inlines: Inline[];
  private size: number;
  private blockLayout: BlockLayout;

  constructor(document: Document, onCreateInlines: (paragraph: Paragraph) => Inline[]) {
    this.document = document;

    // Create inlines
    this.inlines = onCreateInlines(this);

    // Determine size
    this.size = 0;
    this.inlines.forEach(inline => {
      this.size += inline.getSize();
    });

    // Build block layout
    const boxLayouts: BoxLayout[] = [];
    this.inlines.forEach(inline => {
      boxLayouts.push(...inline.getBoxLayouts());
    });
    this.blockLayout = new ParagraphLayout(600, boxLayouts);
  }

  getType(): string {
    return 'Paragraph';
  }

  getDocument(): Document {
    return this.document;
  }

  getInlines(): Inline[] {
    return this.inlines;
  }

  getSize(): number {
    return this.size;
  }

  getBlockLayout(): BlockLayout {
    return this.blockLayout;
  }

  getPositionInDocument(): number {
    const blocks = this.document.getBlocks();
    let cumulatedSize = 0;
    for (let n = 0, nn = blocks.length; n < nn; n++) {
      if (blocks[n] === this) {
        return cumulatedSize;
      }
      cumulatedSize += blocks[n].getSize();
    }
    return -1;
  }

  getInlineAt(position: number): Inline | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.inlines.length; n < nn; n++) {
      cumulatedSize += this.inlines[n].getSize();
      if (cumulatedSize > position) {
        return this.inlines[n];
      }
    }
    return null;
  }
}

export class ParagraphLayout implements BlockLayout {
  private width: number;
  private lines: LineLayout[];

  constructor(width: number, boxes: BoxLayout[]) {
    this.width = width;
    this.lines = buildLinesFromBoxes(width, boxes);
  }

  getType(): string {
    return 'Paragraph';
  }

  getSize(): number {
    let size = 0;
    this.lines.forEach(line => {
      size += line.getSize();
    });
    return size;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    let height = 0;
    this.lines.forEach(line => {
      height += line.getHeight();
    });
    return height;
  }

  getLines(): LineLayout[] {
    return this.lines;
  }
}

type ParagraphViewProps = {
  blockLayout: ParagraphLayout;
};
export class ParagraphView extends React.Component<ParagraphViewProps> {
  render() {
    const { blockLayout } = this.props;
    return (
      <div className="tw--paragraph" data-tw-role="paragraph">
        {blockLayout.getLines().map((lineLayout, lineLayoutIndex) => (
          <LineView key={lineLayoutIndex} lineLayout={lineLayout} />
        ))}
      </div>
    );
  }
}
viewRegistry.registerBlockView('Paragraph', ParagraphView);
