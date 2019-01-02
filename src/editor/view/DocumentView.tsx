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
        {document.getPageLayouts().map((pageLayout, pageLayoutIndex) => (
          <PageView
            key={pageLayoutIndex}
            document={document}
            pageLayout={pageLayout}
            editingCursors={editingCursors}
            observingCursors={observingCursors}
          />
        ))}
      </div>
    );
  }
}
