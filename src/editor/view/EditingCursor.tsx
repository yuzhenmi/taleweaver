import React, { Component } from 'react';
import State from '../state/State';
import Cursor from '../cursor/Cursor';
import resolveLayoutPosition from '../position/util/resolveLayoutPosition';
import projectLayoutPosition from '../position/util/projectLayoutPosition';

type EditingCursorProps = {
  state: State
  cursor: Cursor;
};
export default class EditingCursor extends Component<EditingCursorProps> {
  render() {
    const {
      state,
      cursor,
    } = this.props;
    const resolvedAnchor = resolveLayoutPosition(state.getDocument(), cursor.getAnchor());
    const resolvedHead = resolveLayoutPosition(state.getDocument(), cursor.getHead());
    if (!resolvedAnchor || !resolvedHead) {
      return null;
    }
    const anchorCoordinates = projectLayoutPosition(resolvedAnchor);
    const headCoordinates = projectLayoutPosition(resolvedHead);
    return (
      <div
        className="tw--editing-cursor"
        style={{
          position: 'absolute',
          left: anchorCoordinates.x,
          top: anchorCoordinates.y,
        }}
      >
      </div>
    );
  }
}
