import React, { ReactNode } from 'react';
import Block from './Block';

type PageViewProps = {
  page: Page;
};
class PageView extends React.Component<PageViewProps> {
  render() {
    const {
      page,
    } = this.props;
    return (
      <div
        className="tw--page"
        data-tw-role="page"
        style={{
          position: 'relative',
          width: '600px',
          height: '776px',
        }}
      >
        {page.getBlocks().map(block => block.render())}
      </div>
    );
  }
}

export default class Page {
  private width: number;
  private height: number;
  private blocks: Block[];

  constructor(width: number, height: number, blocks: Block[]) {
    this.width = width;
    this.height = height;
    this.blocks = blocks;
  }

  getSize(): number {
    let size = 0;
    this.blocks.forEach(block => {
      size += block.getSize();
    });
    return size;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getBlocks(): Block[] {
    return this.blocks;
  }

  render(): ReactNode {
    return <PageView page={this} />
  }
}
