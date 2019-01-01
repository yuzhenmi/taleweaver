import React, { Component } from 'react';
import State from '../state/State';
import EditingCursor from './EditingCursor';
import ObservingCursor from './ObservingCursor';

type DocumentProps = {
  state: State;
};
export default class Document extends Component<DocumentProps> {
  render() {
    const {
      state: editorState,
    } = this.props;
    const document = editorState.getDocument();
    const editingCursors = editorState.getEditingCursors();
    const observingCursors = editorState.getObservingCursors();
    return (
      <div className="tw--document">
        <div className="tw--pages">
          {document.getPages().map(page => page.render())}
        </div>
        <div className="tw--editing-cursors">
          {editingCursors.map((cursor, cursorIndex) => (
            <EditingCursor key={cursorIndex} state={editorState} cursor={cursor} />
          ))}
        </div>
        <div className="tw--observing-cursors">
          {observingCursors.map((cursor, cursorIndex) => (
            <ObservingCursor key={cursorIndex} state={editorState} cursor={cursor} />
          ))}
        </div>
      </div>
    );
  }
}
