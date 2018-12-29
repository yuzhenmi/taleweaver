import React, { Component } from 'react';
import Line, { TokenLine } from './Line';

export type TokenBlock = {
  lines: TokenLine[];
  height: number;
};

type BlockProps = {
  tokenBlock: TokenBlock;
};

export default class Block extends Component<BlockProps> {
  render() {
    const {
      tokenBlock,
    } = this.props;
    return (
      <div className="tw--block">
        {tokenBlock.lines.map((tokenLine, tokenLineIndex) => (
          <Line key={tokenLineIndex} tokenLine={tokenLine} />
        ))}
      </div>
    );
  }
}
