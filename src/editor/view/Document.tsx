import React, { Component } from 'react';
import State from '../state/State';
import EditingCursor from './EditingCursor';
import DocumentModel from '../model/Document';
import tokenizeBlockElement from './util/tokenizeBlockElement';
import Page, { TokenPage } from './Page';
import { TokenBlock } from './Block';
import { TokenLine } from './Line';

type DocumentProps = {
  state: State;
};

export default class Document extends Component<DocumentProps> {
  private tokenPages: TokenPage[];

  constructor(props: DocumentProps) {
    super(props);
    this.tokenPages = [];
    this.buildTokens(props.state.getDocument());
  }

  componentWillReceiveProps(nextProps: DocumentProps) {
    this.buildTokens(nextProps.state.getDocument());
  }

  buildTokens(document: DocumentModel) {
    const PAGE_WIDTH = 480;
    const PAGE_HEIGHT = 656;
    this.tokenPages = [];
    let tokenPage: TokenPage = { blocks: [] };
    let cumulatedHeight = 0;
    const pushPage = () => {
      this.tokenPages.push(tokenPage);
      cumulatedHeight = 0;
      tokenPage = { blocks: [] };
    }
    let tokenBlock: TokenBlock = { lines: [], height: 0 };
    const pushBlockToPage = () => {
      tokenPage.blocks.push(tokenBlock);
      tokenBlock = { lines: [], height: 0 };
    }
    document.getChildren().forEach(blockElement => {
      const flatTokens = tokenizeBlockElement(blockElement);
      let tokenLine: TokenLine = { tokens: [], height: 0 };
      let cumulatedWidth = 0;
      const pushLineToBlock = () => {
        if (cumulatedHeight + tokenLine.height > PAGE_HEIGHT) {
          pushBlockToPage();
          pushPage();
        }
        tokenBlock.lines.push(tokenLine);
        tokenBlock.height += tokenLine.height;
        cumulatedWidth = 0;
        cumulatedHeight += tokenLine.height;
        tokenLine = { tokens: [], height: 0 };
      }
      flatTokens.forEach(token => {
        if (cumulatedWidth + token.getWidth() > PAGE_WIDTH) {
          pushLineToBlock();
        }
        cumulatedWidth += token.getWidth();
        tokenLine.tokens.push(token);
        if (token.getHeight() > tokenLine.height) {
          tokenLine.height = token.getHeight();
        }
      });
      if (tokenLine.tokens.length > 0) {
        pushLineToBlock();
      }
      pushBlockToPage();
    });
    if (tokenPage.blocks.length > 0) {
      pushPage();
    }
  }

  render() {
    const {
      state: editorState,
    } = this.props;
    const editingCursors = editorState.getEditingCursors();
    return (
      <div className="tw--document">
        <div className="tw--pages">
          {this.tokenPages.map((tokenPage, tokenPageIndex) => (
            <Page
              key={tokenPageIndex}
              tokenPage={tokenPage}
            />
          ))}
        </div>
        <div className="tw--editing-cursors">
          {editingCursors.map((cursor, cursorIndex) => (
            <EditingCursor key={cursorIndex} cursor={cursor} />
          ))}
        </div>
      </div>
    );
  }
}
