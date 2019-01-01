import React from 'react';
import PageLayout from '../layout/PageLayout';
import viewRegistry from './util/viewRegistry';

type PageViewProps = {
  pageLayout: PageLayout;
};
export default class PageView extends React.Component<PageViewProps> {
  render() {
    const {
      pageLayout,
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
        {pageLayout.getBlockLayouts().map((blockLayout, blockLayoutIndex) => {
          const BlockView = viewRegistry.getBlockView(blockLayout.getType());
          if (!BlockView) {
            return null;
          }
          return (
            <BlockView key={blockLayoutIndex} blockLayout={blockLayout} />
          );
        })}
      </div>
    );
  }
}
