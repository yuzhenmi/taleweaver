import Editor from '../Editor';
import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken, { Attributes } from '../state/OpenTagToken';
import Token from '../state/Token';
import BlockNode from './BlockModelNode';
import ModelNode, { ModelPosition } from './ModelNode';

type ChildNode = BlockNode<any>;

interface DocAttributes extends Attributes { }

export default class DocModelNode extends ModelNode<DocAttributes, never, ChildNode> {
  protected size?: number;

  constructor(editor: Editor) {
    super(editor, { id: 'Doc' });
  }

  isRoot() {
    return true;
  }

  isLeaf() {
    return false;
  }

  getType() {
    return 'Doc';
  }

  getSize() {
    if (this.size === undefined) {
      this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 2);
    }
    return this.size!;
  }

  clearCache() {
    this.size = undefined;
  }

  toHTML(from: number, to: number) {
    const $element = document.createElement('div');
    let offset = 1;
    const childNodes = this.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn && offset < to; n++) {
      const child = childNodes[n];
      const childSize = child.getSize();
      const childFrom = Math.max(0, from - offset);
      const childTo = Math.min(childFrom + childSize, to - offset);
      offset += childSize;
      if (childFrom > childSize || childTo < 0) {
        continue;
      }
      const $childElement = child.toHTML(childFrom, childTo);
      $element.appendChild($childElement);
    }
    return $element;
  }

  toTokens() {
    const tokens: Token[] = [];
    tokens.push(new OpenTagToken(this.getType(), this.getID(), this.getAttributes()));
    this.getChildNodes().forEach(childNode => {
      tokens.push(...childNode.toTokens());
    });
    tokens.push(new CloseTagToken());
    return tokens;
  }

  resolvePosition(offset: number) {
    let cumulatedOffset = 1;
    const childNodes = this.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn; n++) {
      const child = childNodes[n];
      const childSize = child.getSize();
      if (cumulatedOffset + childSize > offset) {
        const position: ModelPosition = {
          node: this,
          depth: 0,
          offset,
        };
        const childPosition = child.resolvePosition(offset - cumulatedOffset, 1);
        position.child = childPosition;
        childPosition.parent = position;
        return position;
      }
      cumulatedOffset += childSize;
    }
    throw new Error(`Offset ${offset} is out of range.`);
  }
}
