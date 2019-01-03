import React from 'react';
import Document from '../Document';
import Block from './Block';
import Inline from '../inline/Inline';
import BlockLayout from '../../layout/BlockLayout';
import LineLayout from '../../layout/LineLayout';
import BoxLayout from '../../layout/BoxLayout';
import LineView from '../../view/LineView';
import viewRegistry from '../../view/util/viewRegistry';
import LineBreak from '../inline/LineBreak';
import PageLayout from '../../layout/PageLayout';

export default class Paragraph implements Block {
  private document: Document;
  private inlines: Inline[];
  private size: number;

  constructor(document: Document, onCreateInlines: (paragraph: Paragraph) => Inline[]) {
    this.document = document;

    // Create inlines
    this.inlines = onCreateInlines(this);

    // Append line break at the end
    this.inlines.push(new LineBreak(this));

    // Determine size
    this.size = 0;
    this.inlines.forEach(inline => {
      this.size += inline.getSize();
    });
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

  buildBlockLayout(pageLayout: PageLayout): BlockLayout {
    let inlineIndex = 0;
    let boxIndex = 0;
    return new ParagraphLayout(pageLayout, (lineLayout, availableWidth) => {
      const boxLayouts: BoxLayout[] = [];
      let cumulatedWidth = 0;
      while (inlineIndex < this.inlines.length) {
        const builtBoxLayouts = this.inlines[inlineIndex].buildBoxLayouts(lineLayout);
        while (boxIndex < builtBoxLayouts.length) {
          const boxLayout = builtBoxLayouts[boxIndex];
          cumulatedWidth += boxLayout.getWidth();
          if (cumulatedWidth > availableWidth) {
            return boxLayouts;
          }
          boxLayouts.push(boxLayout);
          boxIndex++;
        }
        inlineIndex++;
        boxIndex = 0;
      }
      return boxLayouts;
    });
  }
}

export class ParagraphLayout implements BlockLayout {
  private pageLayout: PageLayout;
  private width: number;
  private lineLayouts: LineLayout[];

  constructor(pageLayout: PageLayout, buildBoxLayouts: (lineLayout: LineLayout, availableWidth: number) => BoxLayout[]) {
    this.pageLayout = pageLayout;
    this.width = pageLayout.getWidth();

    // Build line and box layouts
    this.lineLayouts = [];
    while (true) {
      const lineLayout = new LineLayout(this, buildBoxLayouts);
      if (lineLayout.getBoxLayouts().length === 0) {
        break;
      }
      this.lineLayouts.push(lineLayout);
    }
  }

  getType(): string {
    return 'Paragraph';
  }

  getSize(): number {
    let size = 0;
    this.lineLayouts.forEach(line => {
      size += line.getSize();
    });
    return size;
  }

  getPageLayout(): PageLayout {
    return this.pageLayout;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    let height = 0;
    this.lineLayouts.forEach(line => {
      height += line.getHeight();
    });
    return height;
  }

  getLineLayouts(): LineLayout[] {
    return this.lineLayouts;
  }

  getLineLayoutAt(position: number): LineLayout | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.lineLayouts.length; n < nn; n++) {
      cumulatedSize += this.lineLayouts[n].getSize();
      if (cumulatedSize > position) {
        return this.lineLayouts[n];
      }
    }
    return null;
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
        {blockLayout.getLineLayouts().map((lineLayout, lineLayoutIndex) => (
          <LineView key={lineLayoutIndex} lineLayout={lineLayout} />
        ))}
      </div>
    );
  }
}
viewRegistry.registerBlockView('Paragraph', ParagraphView);
