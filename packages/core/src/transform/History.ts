import Editor from '../Editor';
import AppliedTransformation from './AppliedTransformation';

class HistoryItem {
  protected timestamp: number;
  protected appliedTransformations: AppliedTransformation[] = [];

  constructor() {
    this.timestamp = Date.now();
  }

  addAppliedTransformation(appliedTransformation: AppliedTransformation) {
    this.appliedTransformations.push(appliedTransformation);
  }

  getAppliedTransformations() {
    return this.appliedTransformations;
  }
}

class History {
  protected editor: Editor;
  protected items: HistoryItem[] = [];
  protected pointer: number = -1;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  recordAppliedTransformation(appliedTransformation: AppliedTransformation) {
    if (this.pointer < this.items.length - 1) {
      this.items.splice(this.pointer + 1, this.items.length - 1 - this.pointer);
    }
    const item = new HistoryItem();
    item.addAppliedTransformation(appliedTransformation);
    this.items.push(item);
    this.pointer++;
  }

  undo(): HistoryItem | null {
    if (this.pointer < 0) {
      return null;
    }
    const item = this.items[this.pointer];
    this.pointer -= 1;
    return item;
  }

  redo(): HistoryItem | null {
    if (this.pointer > this.items.length - 2) {
      return null;
    }
    this.pointer += 1;
    return this.items[this.pointer];
  }
}

export default History;
