import React from 'react';;
import styled from 'styled-components';
import { Editor, Config, TextStyle, ViewStateUpdatedEvent } from '@taleweaver/core';

import ToolBar from './ToolBar';

const Wrapper = styled.div`
`;

const EditorWrapper = styled.div`
  text-align: center;
  .tw--doc {
    font-family: 'Source Sans Pro', sans-serif;
    display: inline-block;
    padding-bottom: 9px;
    counter-reset: page-counter;
  }
  .tw--page {
    background: rgba(255, 255, 255, 1);
    margin: 9px auto 0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    position: relative;
    &::after {
      counter-increment: page-counter;
      content: "Page "counter(page-counter)"";
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 10px;
      font-family: 'Quicksand', sans-serif;
      font-weight: 500;
      color: rgba(0, 0, 0, 0.45);
      pointer-events: none;
    }
  }
  .tw--page *::selection {
    background: rgba(255, 255, 255, 1);
  }
`;

type Props = {
  initialMarkup: string;
}

type State = {
  editor: Editor | null;
  textStyle: TextStyle | null;
}

export default class Taleweaver extends React.Component<Props, State> {
  protected domRef: React.RefObject<HTMLDivElement>;

  constructor(props: Props) {
    super(props);
    this.domRef = React.createRef();
    this.state = { editor: null, textStyle: null };
  }

  componentDidMount() {
    const { initialMarkup } = this.props;
    const domElement = this.domRef.current!;
    const config = new Config();
    const editor = new Editor(config, initialMarkup, domElement);
    this.setState({ editor });
    editor.getDispatcher().on(ViewStateUpdatedEvent, event => {
      this.onChange();
    });
    this.onChange();
  }

  render() {
    const { textStyle } = this.state;
    return (
      <Wrapper>
        <ToolBar textStyle={textStyle} />
        <EditorWrapper ref={this.domRef} />
      </Wrapper>
    );
  }

  protected onChange() {
    setTimeout(() => {
      const editor = this.state.editor!;
      const cursor = editor.getCursor();
      const textStyle = editor.getRenderManager().getTextStyleBetween(
        cursor.getAnchor(),
        cursor.getHead(),
      );
      this.setState({ textStyle });
    });
  }
}
