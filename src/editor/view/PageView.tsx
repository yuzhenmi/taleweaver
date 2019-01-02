import React from 'react';
import Document from '../element/Document';
import PageLayout from '../layout/PageLayout';
import viewRegistry from './util/viewRegistry';
import EditingCursor from './EditingCursor';
import ObservingCursor from './ObservingCursor';
import Cursor from '../cursor/Cursor';

type PageViewProps = {
  document: Document;
  pageLayout: PageLayout;
  editingCursors: Cursor[];
  observingCursors: Cursor[];
};
export default class PageView extends React.Component<PageViewProps> {
  render() {
    const {
      document,
      pageLayout,
      editingCursors,
      observingCursors,
    } = this.props;
    return (
      <div
        className="tw--page"
        data-tw-role="page"
        style={{
          width: '720px',
          height: '896px',
          padding: '60px',
          position: 'relative',
        }}
      >
        <div
          className="tw--page-cursors"
          data-tw-role="page-cursors"
          style={{ position: 'absolute', top: '60px', bottom: '60px', left: '60px', right: '60px' }}
        >
          {editingCursors.map((cursor, cursorIndex) => (
            <EditingCursor
              key={cursorIndex}
              document={document}
              pageLayout={pageLayout}
              cursor={cursor}
            />
          ))}
          {observingCursors.map((cursor, cursorIndex) => (
            <ObservingCursor
              key={cursorIndex}
              document={document}
              pageLayout={pageLayout}
              cursor={cursor}
            />
          ))}
        </div>
        <div
          className="tw--page-body"
          data-tw-role="page-body"
          style={{ position: 'relative' }}
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
      </div>
    );
  }
}
