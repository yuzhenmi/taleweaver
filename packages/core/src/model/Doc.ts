import RootNode from '../tree/RootNode';
import Attributes from '../token/Attributes';
import Element from './Element';
import BlockElement from './BlockElement';

type ChildElement = BlockElement;

const DEFAULT_ATTRIBUTES = {
  width: 816,
  height: 1056,
  padding: 40,
};

export default class Doc extends Element implements RootNode {
  protected children: ChildElement[] = [];
  protected width: number = 0;
  protected height: number = 0;
  protected padding: number = 0;

  getType() {
    return 'Doc';
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
    if (this.width !== attributes.width) {
      this.width = attributes.width;
      isUpdated = true;
    }
    if (this.height !== attributes.height) {
      this.height = attributes.height;
      isUpdated = true;
    }
    if (this.padding !== attributes.padding) {
      this.padding = attributes.padding;
      isUpdated = true;
    }
    return isUpdated;
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
    return this.height;
  }

  getPadding() {
    return this.padding;
  }

  getAttributes() {
    return {
      id: this.id!,
      width: this.width,
      height: this.height,
      padding: this.padding,
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
