import React from 'react';;
import styled from 'styled-components';
import { Editor, Config } from '@taleweaver/core';

const EditorWrapper = styled.div`
  text-align: center;
`;

type EditorComponentProps = {
  initialMarkup: string;
}

type EditorComponentState = {
  editor: Editor;
}

export default class EditorComponent extends React.Component<EditorComponentProps, EditorComponentState> {
  protected domRef: React.RefObject<HTMLDivElement>;

  constructor(props: EditorComponentProps) {
    super(props);
    this.domRef = React.createRef();
    const config = new Config();
    const editor = new Editor(config, props.initialMarkup);
    this.state = { editor };
  }

  componentDidMount() {
    const domElement = this.domRef.current!;
    this.state.editor.mount(domElement);
  }

  render() {
    return (
      <EditorWrapper ref={this.domRef} />
    );
  }
}
