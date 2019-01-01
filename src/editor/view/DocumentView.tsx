import React, { Component } from 'react';
import State from '../state/State';
import EditingCursor from './EditingCursor';
import ObservingCursor from './ObservingCursor';
import PageView from './PageView';

type DocumentViewProps = {
  state: State;
};
export default class DocumentView extends Component<DocumentViewProps> {
  render() {
    const {
      state: editorState,
    } = this.props;
    const document = editorState.getDocument();
    const editingCursors = editorState.getEditingCursors();
    const observingCursors = editorState.getObservingCursors();
    return (
      <div className="tw--document" data-tw-role="document">
        <div className="tw--pages" data-tw-role="pages">
          {document.getPageLayouts().map((pageLayout, pageLayoutIndex) => (
            <PageView key={pageLayoutIndex} pageLayout={pageLayout} />
          ))}
        </div>
        <div className="tw--editing-cursors" data-tw-role="editing-cursors">
          {editingCursors.map((cursor, cursorIndex) => (
            <EditingCursor key={cursorIndex} state={editorState} cursor={cursor} />
          ))}
        </div>
        <div className="tw--observing-cursors" data-tw-role="observing-cursors">
          {observingCursors.map((cursor, cursorIndex) => (
            <ObservingCursor key={cursorIndex} state={editorState} cursor={cursor} />
          ))}
        </div>
      </div>
    );
  }
}
