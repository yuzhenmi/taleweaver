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
  editor: Editor | null;
}

export default class EditorComponent extends React.Component<EditorComponentProps, EditorComponentState> {
  protected domRef: React.RefObject<HTMLDivElement>;

  constructor(props: EditorComponentProps) {
    super(props);
    this.domRef = React.createRef();
    this.state = { editor: null };
  }

  componentDidMount() {
    const { initialMarkup } = this.props;
    const domElement = this.domRef.current!;
    const config = new Config();
    const editor = new Editor(config, initialMarkup, domElement);
    this.setState({ editor });
  }

  render() {
    return (
      <EditorWrapper ref={this.domRef} />
    );
  }
}
