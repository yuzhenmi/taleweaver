import RootNode from '../tree/RootNode';
import Attributes from '../token/Attributes';
import Element from './Element';
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
      if (from > childTo || to < childFrom) {
        continue;
      }
      const $childElement = child.toHTML(childFrom, childTo);
      $element.appendChild($childElement);
      offset += childSize;
    }
    return $element;
  }
}
