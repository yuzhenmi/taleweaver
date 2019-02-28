import TaleWeaver from '../TaleWeaver';
import State from '../state/State';
import Token from '../state/Token';
import DocStartToken from '../state/DocStartToken';
import DocEndToken from '../state/DocEndToken';
import RootNode from './RootNode';
import Block from './Block';
import StartToken from '../state/StartToken';
import EndToken from '../state/EndToken';

type Child = Block;

export default class Doc extends RootNode {
  static getType(): string {
    return 'Doc';
  }

  protected taleWeaver: TaleWeaver;
  protected tokens: Token[];
  protected id: string;
  protected children: Child[];

  constructor(taleWeaver: TaleWeaver, state: State) {
    super();
    this.taleWeaver = taleWeaver;
    this.children = [];
    const tokens = state.getTokens();
    this.validateTokens(tokens);
    this.tokens = [tokens[0], tokens[tokens.length - 1]];
    const startToken = tokens[0] as DocStartToken;
    const { id } = startToken.getAttributes();
    this.id = id;
    state.subscribe(this.onStateUpdated);
    this.updateFromTokens(tokens);
    this.tokens = tokens;
  }

  getType(): string {
    return Doc.getType();
  }

  getID(): string {
    return this.id;
  }

  getSize(): number {
    let size = 2;
    this.children.forEach(child => {
      size += child.getSize();
    });
    return size;
  }

  getSelectableSize(): number {
    let size = 0;
    this.children.forEach(child => {
      size += child.getSelectableSize();
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

  updateFromTokens(tokens: Token[]) {
    // Break up tokens by children
    interface TokenChild {
      id: string;
      type: string;
      tokens: Token[];
    }
    const tokenChildren: TokenChild[] = [];
    let depth = 0;
    let startToken: StartToken;
    let startOffset = 1;
    for (let n = 1, nn = tokens.length - 1; n < nn; n++) {
      const token = tokens[n];
      if (token instanceof StartToken) {
        if (depth === 0) {
          startToken = token;
          startOffset = n;
        }
        depth++;
      } else if (token instanceof EndToken) {
        depth--;
        if (depth === 0) {
          tokenChildren.push({
            id: startToken!.getAttributes().id,
            type: startToken!.getType(),
            tokens: tokens.slice(startOffset, n + 1),
          });
        }
      }
    }

    // Compare token children with current children and add/update/delete
    // children as needed
    const config = this.taleWeaver.getConfig();
    const children = this.children.slice();
    const invertedTokenChildren: {
      [key: string]: number;
    } = {};
    tokenChildren.forEach((tokenChild, offset) => {
      invertedTokenChildren[tokenChild.id] = offset;
    });
    const invertedChildren: {
      [key: string]: number;
    } = {};
    children.forEach((child, offset) => {
      invertedChildren[child.getID()] = offset;
    });
    const tokenChildrenSize = tokenChildren.length;
    const childrenSize = this.children.length;
    let tokenChildOffset = 0;
    let childOffset = 0;
    let operationOffset = 0;
    while (tokenChildOffset < tokenChildrenSize || childOffset < childrenSize) {
      if (!(tokenChildren[tokenChildOffset].id in invertedChildren) || childOffset === childrenSize) {
        // Insert child
        const tokenChild = tokenChildren[tokenChildOffset];
        const ChildClass = config.getBlockClass(tokenChild.type);
        const child = new ChildClass(this.taleWeaver, this, tokenChild.tokens);
        this.children.splice(operationOffset, 0, child);
        operationOffset++;
        tokenChildOffset++;
      } else if (!(children[childOffset].getID() in invertedTokenChildren) || tokenChildOffset === tokenChildrenSize) {
        // Delete child
        this.children.splice(operationOffset, 1);
        childOffset++;
      } else {
        // Update child
        const tokenChild = tokenChildren[tokenChildOffset];
        const child = children[childOffset];
        child.updateFromTokens(tokenChild.tokens);
        operationOffset++;
        tokenChildOffset++;
        childOffset++;
      }
    }
  }

  protected validateTokens(tokens: Token[]) {
    const startToken = tokens[0];
    if (!(startToken instanceof DocStartToken)) {
      throw new Error('Invalid doc tokens, first token is not a DocStartToken.');
    }
    const endToken = tokens[tokens.length - 1];
    if (!(endToken instanceof DocEndToken)) {
      throw new Error('Invalid doc tokens, last token is not a DocEndToken.');
    }
  }

  protected onStateUpdated = (state: State) => {
    const tokens = state.getTokens();
    this.updateFromTokens(tokens);
  }
}
