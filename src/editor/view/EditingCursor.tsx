import React, { Component } from 'react';
import Cursor from '../cursor/Cursor';

type EditingCursorProps = {
  cursor: Cursor;
};

export default class EditingCursor extends Component<EditingCursorProps> {
  render() {
    const {
      cursor,
    } = this.props;
    return (
      <div style={{width: '2px', height: '12px', background: 'black'}}>
      </div>
    );
  }
}
