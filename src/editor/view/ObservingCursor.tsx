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
    return (
      <div
        className="tw--observing-cursor"
      >
      </div>
    );
  }
}
