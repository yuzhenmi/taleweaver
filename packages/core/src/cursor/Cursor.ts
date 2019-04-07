import Transformation from './Transformation';
import { MoveTo, MoveHeadTo } from './operations';
import Editor from '../Editor';

export type OnUpdatedSubscriber = () => void;

export default class Cursor {
  protected editor: Editor;
  protected anchor: number;
  protected head: number;
  protected leftAnchor: number | null;
  protected onUpdatedSubscribers: OnUpdatedSubscriber[];

  constructor(editor: Editor) {
    this.editor = editor;
    this.anchor = 0;
    this.head = 0;
    this.leftAnchor = null;
    this.onUpdatedSubscribers = [];
  }

  getAnchor(): number {
    return this.anchor;
  }

  getHead(): number {
    return this.head;
  }

  getLeftAnchor(): number | null {
    return this.leftAnchor;
  }

  subscribeOnUpdated(subscriber: OnUpdatedSubscriber) {
    this.onUpdatedSubscribers.push(subscriber);
  }

  applyTransformation(transformation: Transformation) {
    this.leftAnchor = transformation.getLeftAnchor();
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
    this.onUpdatedSubscribers.forEach(subscriber => subscriber());
  }
}
