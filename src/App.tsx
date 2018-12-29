import React, { Component, Children } from 'react';
import './App.css';
import JSONParser from './editor/model/util/JSONParser';
import EditorState from './editor/state/State';
import Document from './editor/view/Document';
import Cursor from './editor/cursor/Cursor';

const jsonParser = new JSONParser();
const documentJson = {
  children: [],
};
for (let n = 0; n < 500; n++) {
  documentJson.children.push({
    // @ts-ignore
    type: 'Paragraph',
    children: [
      {
        // @ts-ignore
        type: 'Text',
        // @ts-ignore
        content: 'Hello world!',
      },
    ],
  });
}
const document = jsonParser.parse(documentJson);
const cursor = new Cursor(0, 0);
const initialEditorState = new EditorState(document, [cursor]);

class App extends Component {
  state = {
    editorState: initialEditorState,
  }

  render() {
    const {editorState} = this.state;
    return (
      <div className="App">
        <Document
          state={editorState}
        />
      </div>
    );
  }
}

export default App;
