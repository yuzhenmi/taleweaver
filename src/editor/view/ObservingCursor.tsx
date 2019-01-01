import React, { Component } from 'react';
import State from '../state/State';
import Cursor from '../cursor/Cursor';
import resolveElementPosition from '../position/util/resolveElementPosition';

type ObservingCursorProps = {
  state: State
  cursor: Cursor;
};
export default class ObservingCursor extends Component<ObservingCursorProps> {
  render() {
    const {
      state,
      cursor,
    } = this.props;
    const resolvedAnchor = resolveElementPosition(state.getDocument(), cursor.getAnchor());
    const resolvedHead = resolveElementPosition(state.getDocument(), cursor.getHead());
    return (
      <div style={{width: '2px', height: '12px', background: 'black'}}>
      </div>
    );
  }
}
