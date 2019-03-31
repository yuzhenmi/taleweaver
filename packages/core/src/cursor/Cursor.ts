import Transformation from './Transformation';
import { MoveTo, MoveHeadTo } from './operations';
import Editor from '../Editor';

export type OnChangedSubscriber = () => void;

export default class Cursor {
  protected editor: Editor;
  protected anchor: number;
  protected head: number;
  protected onChangedSubscribers: OnChangedSubscriber[];

  constructor(editor: Editor) {
    this.editor = editor;
    this.anchor = 0;
    this.head = 0;
    this.onChangedSubscribers = [];
  }

  getAnchor(): number {
    return this.anchor;
  }

  getHead(): number {
    return this.head;
  }

  subscribeOnUpdated(subscriber: OnChangedSubscriber) {
    this.onChangedSubscribers.push(subscriber);
  }

  applyTransformation(transformation: Transformation) {
    const operations = transformation.getOperations();
    if (operations.length === 0) {
      return;
    }
    operations.forEach(operation => {
      if (operation instanceof MoveTo) {
        const offset = operation.getOffset();
        this.anchor = offset;
        this.head = offset;
      } else if (operation instanceof MoveHeadTo) {
        const offset = operation.getOffset();
        this.head = offset;
      } else {
        throw new Error('Unrecognized cursor transformation operation.');
      }
    });
    this.onChangedSubscribers.forEach(subscriber => subscriber());
  }
}
