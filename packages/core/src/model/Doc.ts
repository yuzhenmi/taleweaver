import RootNode from '../tree/RootNode';
import Token from '../token/Token';
import OpenTagToken from '../token/OpenTagToken';
import CloseTagToken from '../token/CloseTagToken';
import Attributes from '../token/Attributes';
import Element, { ResolvedPosition } from './Element';
import BlockElement from './BlockElement';

type ChildElement = BlockElement;

const DEFAULT_ATTRIBUTES = {};

export default class Doc extends Element implements RootNode {
  protected children: ChildElement[] = [];

  getType() {
    return 'Doc';
  }

  setVersion(version: number) {
    if (this.version < version) {
      this.version = version;
    }
  }

  insertChild(child: ChildElement, offset: number | null = null) {
    child.setParent(this);
    if (offset === null) {
      this.children.push(child);
    } else {
      this.children.splice(offset, 0, child);
    }
    this.clearCache();
  }

  deleteChild(child: ChildElement) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    child.setParent(null);
    this.children.splice(childOffset, 1);
    this.clearCache();
  }

  getChildren() {
    return this.children;
  }

  getSize() {
    if (this.size === undefined) {
      let size = 2;
      this.children.forEach(child => {
        size += child.getSize();
      });
      this.size = size;
    }
    return this.size;
  }

  onStateUpdated(attributes: Attributes) {
    attributes = { ...DEFAULT_ATTRIBUTES, ...attributes };
    let isUpdated = false;
    return isUpdated;
  }

  getAttributes() {
    return {
      id: this.id!,
    };
  }

  toHTML(from: number, to: number) {
    const $element = document.createElement('div');
    let offset = 1;
    for (let n = 0, nn = this.children.length; n < nn && offset < to; n++) {
      const child = this.children[n];
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
    this.children.forEach(child => {
      tokens.push(...child.toTokens());
    });
    tokens.push(new CloseTagToken());
    return tokens;
  }

  resolveOffset(offset: number) {
    let cumulatedOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSize = child.getSize();
      if (cumulatedOffset + childSize > offset) {
        const resolvedPosition: ResolvedPosition = {
          element: this,
          depth: 0,
          offset,
          parent: null,
          child: null,
        };
        const childResolvedPosition = child.resolveOffset(offset - cumulatedOffset, 1);
        resolvedPosition.child = childResolvedPosition;
        childResolvedPosition.parent = resolvedPosition;
        return resolvedPosition;
      }
    }
    throw new Error(`Offset ${offset} is out of range.`);
  }
}
