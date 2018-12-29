import React, { Component, ReactNode } from 'react';
import Token from './tokens/Token';

export type TokenLine = {
  tokens: Token[];
  height: number;
};

type LineProps = {
  tokenLine: TokenLine;
};

export default class Line extends Component<LineProps> {
  render() {
    const {
      tokenLine,
    } = this.props;
    const mergedContent: ReactNode[] = [];
    let strs: string[] = [];
    let strCounter = 0;
    tokenLine.tokens.forEach(token => {
      const renderedToken = token.render();
      if (typeof renderedToken === 'string') {
        strs.push(renderedToken);
      } else if (strs.length > 0) {
        mergedContent.push(
          <span key={strCounter}>{strs.join('')}</span>
        );
        strs = [];
        strCounter++;
      }
    });
    if (strs.length > 0) {
      if (mergedContent.length > 0) {
        mergedContent.push(
          <span key={strCounter}>{strs.join('')}</span>
        );
      } else {
        mergedContent.push(strs.join(''));
      }
    }
    let contentNode: ReactNode;
    if (mergedContent.length === 1) {
      contentNode = mergedContent[0];
    } else {
      contentNode = mergedContent;
    }
    return <div className="tw--line">{contentNode}</div>;
  }
}
