import React, { Component } from 'react';
import State from '../state/State';
import Cursor from '../cursor/Cursor';
import resolveElementPosition from '../position/util/resolveElementPosition';
import projectResolvedPosition from '../position/util/projectResolvedPosition';

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
    const resolvedAnchor = resolveElementPosition(state.getDocument(), cursor.getAnchor());
    const resolvedHead = resolveElementPosition(state.getDocument(), cursor.getHead());
    if (!resolvedAnchor || !resolvedHead) {
      return null;
    }
    const anchorCoordinates = projectResolvedPosition(resolvedAnchor);
    const headCoordinates = projectResolvedPosition(resolvedHead);
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
