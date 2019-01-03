import React, { Component } from 'react';
import Document from '../element/Document';
import PageLayout from '../layout/PageLayout';
import Cursor from '../cursor/Cursor';
import resolveLayoutPosition from '../position/util/resolveLayoutPosition';
import projectLayoutPositionToPage from '../position/util/projectLayoutPositionToPage';
import projectLayoutPositionRangeToPage from '../position/util/projectLayoutPositionRangeToPage';

type SelectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type EditingCursorProps = {
  document: Document;
  pageLayout: PageLayout;
  cursor: Cursor;
};
export default class EditingCursor extends Component<EditingCursorProps> {
  render() {
    const {
      document,
      pageLayout,
      cursor,
    } = this.props;

    // Resolve anchor and head layout positions
    const anchorLayoutPosition = resolveLayoutPosition(document, cursor.getAnchor());
    const headLayoutPosition = resolveLayoutPosition(document, cursor.getHead());
    if (!anchorLayoutPosition || !headLayoutPosition) {
      return null;
    }

    // Project to page
    const headPagePosition = projectLayoutPositionToPage(headLayoutPosition, pageLayout);
    const selectionBoxes = projectLayoutPositionRangeToPage(anchorLayoutPosition, headLayoutPosition, pageLayout);

    // Don't render if nothing on page
    if (!headPagePosition && selectionBoxes.length === 0) {
      return null;
    }

    return (
      <div
        className="tw--editing-cursor"
        data-tw-role="cursor"
      >
        {selectionBoxes.map((selectionBox, selectionBoxIndex) => (
          <div
            key={selectionBoxIndex}
            className="tw--editing-cursor-selection"
            data-tw-role="cursor-selection"
            style={{
              position: 'absolute',
              left: selectionBox.x,
              top: selectionBox.y,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
        ))}
        {headPagePosition && (
          <div
            className="tw--editing-cursor-head"
            data-tw-role="cursor-head"
            style={{
              position: 'absolute',
              left: headPagePosition.x,
              top: headPagePosition.y,
              height: headPagePosition.height,
            }}
          />
        )}
      </div>
    );
  }
}
