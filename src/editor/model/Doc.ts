import TaleWeaver from '../TaleWeaver';
import RootNode from '../tree/RootNode';
import State, { StateChangedOffsetRange } from '../state/State';
import DocStartToken from '../state/DocStartToken';
import DocEndToken from '../state/DocEndToken';
import BlockStartToken from '../state/BlockStartToken';
import BlockEndToken from '../state/BlockEndToken';
import Block from './Block';

type Child = Block;

interface Attributes {
  [key: string]: any;
}

export default class Doc extends RootNode {
  static getType(): string {
    return 'Doc';
  }

  protected taleWeaver: TaleWeaver;
  protected state: State;
  protected children: Child[];
  protected attributes: Attributes;

  constructor(taleWeaver: TaleWeaver, state: State) {
    super();
    this.taleWeaver = taleWeaver;
    this.state = state;
    this.children = [];
    const startToken = state.getTokens()[0] as DocStartToken;
    this.attributes = startToken.getAttributes();
    state.subscribe(this.handleStateChange);
    this.buildFromState();
  }

  getType(): string {
    return Doc.getType();
  }

  getSize(): number {
    let size = 0;
    this.children.forEach(child => {
      size += child.getSize();
    });
    return size;
  }

  appendChild(child: Child) {
    this.children.push(child);
  }

  removeChild(child: Child) {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return;
    }
    this.children.splice(index, 1);
  }

  getChildren(): Child[] {
    return this.children;
  }

  private buildFromState() {
    this.partialBuildFromState(0, this.state.getTokens().length - 1);
  }

  private partialBuildFromState(offsetFrom: number, offsetTo: number) {
    const tokens = this.state.getTokens();
    if (!(tokens[0] instanceof DocStartToken)) {
      throw new Error(`Error building doc from tokens, expecting first token to be DocStartToken.`);
    }
    if (!(tokens[tokens.length - 1] instanceof DocEndToken)) {
      throw new Error(`Error building doc from tokens, expecting last token to be DocEndToken.`);
    }
    let childStartOffset = 1;
    let depth = 0;
    for (let n = 1, nn = tokens.length - 1; n < nn; n++) {
      const token = tokens[n];
      if (token instanceof BlockStartToken) {
        if (depth === 0) {
          childStartOffset = n;
        }
        depth += 1;
      } else if (token instanceof BlockEndToken) {
        depth -= 1;
      }
      if (depth === 0) {
        const childTokens = tokens.slice(childStartOffset, n + 1);
        const blockStartToken = tokens[childStartOffset] as BlockStartToken;
        const BlockClass = this.taleWeaver.getConfig().getBlockClass(blockStartToken.getType());
        const block = new BlockClass(this.taleWeaver, this, childTokens);
        this.appendChild(block);
      }
    }
  }

  private handleStateChange = (state: State, changedOffsetRanges: StateChangedOffsetRange[]) => {
    // Partially rebuild doc based on changed offset ranges
    // TODO
  }
}
