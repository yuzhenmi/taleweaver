import React, { Component } from 'react';
import Document from '../element/Document';
import PageLayout from '../layout/PageLayout';
import Cursor from '../cursor/Cursor';
import resolveLayoutPosition from '../position/util/resolveLayoutPosition';
import projectLayoutPositionToPage from '../position/util/projectLayoutPositionToPage';

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

    // Determine whether anchor and head are in page before, in this page, or in page after
    const pageLayouts = document.getPageLayouts();
    const thisPageLayoutIndex = pageLayouts.indexOf(pageLayout);
    if (thisPageLayoutIndex < 0) {
      return null;
    }
    const anchorPageLayoutIndex = pageLayouts.indexOf(
      anchorLayoutPosition
        .getLineLayoutPosition()
        .getBlockLayoutPosition()
        .getPageLayoutPosition()
        .getPageLayout()
    );
    if (anchorPageLayoutIndex < 0) {
      return null;
    }
    const headPageLayoutIndex = pageLayouts.indexOf(
      headLayoutPosition
        .getLineLayoutPosition()
        .getBlockLayoutPosition()
        .getPageLayoutPosition()
        .getPageLayout()
    );
    if (headPageLayoutIndex < 0) {
      return null;
    }
    const anchorPageLayoutIndexDelta = anchorPageLayoutIndex - thisPageLayoutIndex;
    const headPageLayoutIndexDelta = headPageLayoutIndex - thisPageLayoutIndex;

    // Do not render if cursor does not intersect page
    if (anchorPageLayoutIndexDelta * headPageLayoutIndexDelta > 0) {
      return null;
    }

    // Project anchor and head to page
    const anchorPagePosition = anchorPageLayoutIndexDelta === 0 ? projectLayoutPositionToPage(anchorLayoutPosition) : null;
    const headPagePosition = headPageLayoutIndexDelta === 0 ? projectLayoutPositionToPage(headLayoutPosition) : null;

    // Determine selection boxes
    const selectionBoxes: SelectionBox[] = [];
    if (anchorPageLayoutIndexDelta !== 0 && headPageLayoutIndexDelta !== 0) {
      // Whole page is selected
      let cumulatedHeight = 0;
      pageLayout.getBlockLayouts().forEach(blockLayout => {
        blockLayout.getLineLayouts().forEach(lineLayout => {
          const boxLayouts = lineLayout.getBoxLayouts();
          if (boxLayouts.length === 0) {
            return;
          }
          let cumulatedWidth = 0;
          boxLayouts.forEach(boxLayout => {
            cumulatedWidth += boxLayout.getWidth();
          });
          selectionBoxes.push({
            x: 0,
            y: cumulatedHeight,
            width: cumulatedWidth,
            height: lineLayout.getHeight(),
          });
          cumulatedHeight += lineLayout.getHeight();
        });
      });
    } else if (anchorPageLayoutIndexDelta === 0 && headPageLayoutIndexDelta === 0) {
      // All of selection is within this page
      // TODO
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
