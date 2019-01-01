import React from 'react';
import BlockLayout from '../../layout/BlockLayout';
import BoxLayout from '../../layout/BoxLayout';

type BlockViewProps = {
  blockLayout: BlockLayout;
};
type BlockViewClass = new (...args: any[]) => React.Component<BlockViewProps>;
type BoxViewProps = {
  boxLayout: BoxLayout;
};
type BoxViewClass = new (...args: any[]) => React.Component<BoxViewProps>;

export class ViewRegistry {
  registeredBlockViews: Map<string, BlockViewClass>;
  registeredBoxViews: Map<string, BoxViewClass>;

  constructor() {
    this.registeredBlockViews = new Map<string, BlockViewClass>();
    this.registeredBoxViews = new Map<string, BoxViewClass>();
  }

  registerBlockView(type: string, blockViewClass: BlockViewClass) {
    this.registeredBlockViews.set(type, blockViewClass);
  }

  registerBoxView(type: string, boxViewClass: BoxViewClass) {
    this.registeredBoxViews.set(type, boxViewClass);
  }

  getBlockView(type: string) {
    return this.registeredBlockViews.get(type);
  }

  getBoxView(type: string) {
    return this.registeredBoxViews.get(type);
  }
}

const viewRegistry = new ViewRegistry();
export default viewRegistry;
