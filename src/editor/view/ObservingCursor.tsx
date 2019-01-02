import React, { Component } from 'react';
import Document from '../element/Document';
import PageLayout from '../layout/PageLayout';
import Cursor from '../cursor/Cursor';
import resolveLayoutPosition from '../position/util/resolveLayoutPosition';
import projectLayoutPositionToPage from '../position/util/projectLayoutPositionToPage';

type ObservingCursorProps = {
  document: Document;
  pageLayout: PageLayout;
  cursor: Cursor;
};
export default class ObservingCursor extends Component<ObservingCursorProps> {
  render() {
    const {
      document,
      pageLayout,
      cursor,
    } = this.props;
    const resolvedAnchor = resolveLayoutPosition(document, cursor.getAnchor());
    const resolvedHead = resolveLayoutPosition(document, cursor.getHead());
    if (!resolvedAnchor || !resolvedHead) {
      return null;
    }
    const anchorPagePosition = projectLayoutPositionToPage(resolvedAnchor);
    const headPagePosition = projectLayoutPositionToPage(resolvedHead);
    return (
      <div
        className="tw--editing-cursor"
        style={{
          position: 'absolute',
          left: anchorPagePosition.x,
          top: anchorPagePosition.y,
          height: anchorPagePosition.height,
        }}
      >
      </div>
    );
  }
}
