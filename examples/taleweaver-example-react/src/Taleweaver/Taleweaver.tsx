import Editor, { Config, TextStyle } from '@taleweaver/core';
import CursorUpdatedEvent from '@taleweaver/core/lib/events/CursorUpdatedEvent';
import RenderUpdatedEvent from '@taleweaver/core/lib/events/RenderUpdatedEvent';
import React from 'react';
import styled from 'styled-components';

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
    protected isTextStyleRefreshQueued: boolean = false;

    constructor(props: Props) {
        super(props);
        this.domRef = React.createRef();
        this.state = { editor: null, textStyle: null };
    }

    componentDidMount() {
        const { initialMarkup } = this.props;
        const domElement = this.domRef.current!;
        const config = new Config();
        const editor = new Editor(config);
        this.setState({ editor });
        editor.getDispatcher().on(RenderUpdatedEvent, event => this.refreshTextStyle());
        editor.getDispatcher().on(CursorUpdatedEvent, event => this.refreshTextStyle());
        editor.start(initialMarkup, domElement);
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

    protected refreshTextStyle() {
        this.isTextStyleRefreshQueued = true;
        setTimeout(() => {
            if (!this.isTextStyleRefreshQueued) {
                return;
            }
            const editor = this.state.editor!;
            const cursorService = editor.getCursorService();
            const renderService = editor.getRenderService();
            const textStyle = renderService.getTextStyleBetween(
                cursorService.getAnchor(),
                cursorService.getHead(),
            );
            this.setState({ textStyle });
            this.isTextStyleRefreshQueued = false;
        });
    }
}
