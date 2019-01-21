import BlockElement from './BlockElement';
import State from '../state/State';

export default class DocumentElement {
  private state?: State;
  private children: BlockElement[];

  constructor() {
    this.children = [];
  }

  setState(state: State) {
    this.state = state;
  }

  appendChild(child: BlockElement) {
    this.children.push(child);
  }

  removeChild(child: BlockElement) {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return;
    }
    this.children.splice(index, 1);
  }

  getState(): State {
    return this.state!;
  }

  getChildren(): BlockElement[] {
    return this.children;
  }

  getChildAt(position: number): BlockElement | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      cumulatedSize += this.children[n].getSize();
      if (cumulatedSize > position) {
        return this.children[n];
      }
    }
    return null;
  }

  getSize(): number {
    let size = 0;
    this.children.forEach(child => {
      size += child.getSize();
    });
    return size;
  }
}
