import React, { Component } from 'react';
import Block, { TokenBlock } from './Block';

export type TokenPage = {
  blocks: TokenBlock[];
};

type PageProps = {
  tokenPage: TokenPage;
};

export default class Page extends Component<PageProps> {
  render() {
    const {
      tokenPage,
    } = this.props;
    return (
      <div
        className="tw--page"
        style={{
          width: '600px',
          height: '776px',
          padding: '60px',
        }}
      >
        {tokenPage.blocks.map((tokenBlock, tokenBlockIndex) => (
          <Block key={tokenBlockIndex} tokenBlock={tokenBlock} />
        ))}
      </div>
    );
  }
}
