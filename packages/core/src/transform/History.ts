import Editor from '../Editor';
import AppliedTransformation from './AppliedTransformation';

const HISTORY_COLLAPSE_THRESHOLD = 500;
const HISTORY_COLLAPSE_MAX_DURATION = 2000;

class HistoryItem {
  protected timestamp: number;
  protected lastTimestamp: number;
  protected appliedTransformations: AppliedTransformation[] = [];

  constructor() {
    this.timestamp = Date.now();
    this.lastTimestamp = this.timestamp;
  }

  getTimestamp() {
    return this.timestamp;
  }

  getLastTimestamp() {
    return this.lastTimestamp;
  }

  addAppliedTransformation(appliedTransformation: AppliedTransformation) {
    this.appliedTransformations.push(appliedTransformation);
    this.lastTimestamp = Date.now();
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
    if (appliedTransformation.getOperations().length === 0) {
      return;
    }
    if (this.pointer < this.items.length - 1) {
      this.items.splice(this.pointer + 1, this.items.length - 1 - this.pointer);
    }
    if (this.pointer < 0) {
      this.recordAppliedTransformationToNewItem(appliedTransformation);
      return;
    }
    const currentItem = this.items[this.pointer];
    const now = Date.now();
    if (now - currentItem.getTimestamp() < HISTORY_COLLAPSE_MAX_DURATION && now - currentItem.getLastTimestamp() < HISTORY_COLLAPSE_THRESHOLD) {
      this.recordAppliedTransformationToLastItem(appliedTransformation);
    } else {
      this.recordAppliedTransformationToNewItem(appliedTransformation);
    }
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

  protected recordAppliedTransformationToNewItem(appliedTransformation: AppliedTransformation) {
    const item = new HistoryItem();
    item.addAppliedTransformation(appliedTransformation);
    this.items.push(item);
    this.pointer++;
  }

  protected recordAppliedTransformationToLastItem(appliedTransformation: AppliedTransformation) {
    const currentItem = this.items[this.pointer];
    if (!currentItem) {
      throw new Error('Error recording applied transformation, history is empty.');
    }
    currentItem.addAppliedTransformation(appliedTransformation);
  }
}

export default History;
