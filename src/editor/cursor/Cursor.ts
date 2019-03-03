import Transformation from './Transformation';
import Translate from './operations/Translate';
import TranslateHead from './operations/TranslateHead';

/** Observer to cursor state change. */
type CursorObserver = (cursor: Cursor, keepX: boolean) => void;

/**
 * Generates a unique cursor ID.
 */
function generateID(): string {
  // Generate cursor ID with current timestamp and a random number.
  return `${Date.now().toString(36)}${Math.random().toString(36).substring(2)}`
}

/**
 * Models a cursor on the document.
 */
export default class Cursor {
  /** ID of the cursor. */
  private id: string;
  /** Anchor position of the cursor. */
  private anchor: number;
  /** Head position of the cursor. */
  private head: number;
  /** Observers registered with the cursor. */
  private observers: CursorObserver[];

  /**
   * Creates a new cursor instance.
   * @param anchor - Initial anchor position of the cursor.
   * @param head - Initial head position of the cursor.
   * @param id - ID of the cursor.
   */
  constructor(anchor: number, head: number, id?: string) {
    this.id = id || generateID();
    this.anchor = anchor;
    this.head = head;
    this.observers = [];
  }

  /**
   * Gets the ID of the cursor.
   */
  getID() {
    return this.id;
  }

  /**
   * Registers an observer.
   * @param observer - Observer to register.
   */
  observe(observer: CursorObserver) {
    this.observers.push(observer);
  }

  /**
   * Gets the anchor position.
   */
  getAnchor(): number {
    return this.anchor!;
  }

  /**
   * Gets the head position.
   */
  getHead(): number {
    return this.head!;
  }

  transform(transformation: Transformation) {
    const operations = transformation.getOperations();
    operations.forEach(operation => {
      if (operation instanceof Translate) {
        this.head = this.head += operation.getDisplacement();
        this.anchor = this.head;
      } else if (operation instanceof TranslateHead) {
        this.head = this.head += operation.getDisplacement();
      } else {
        throw new Error('Unrecognized transformation operation.');
      }
    });
    this.observers.forEach(observer => {
      observer(this, transformation.getKeepX());
    });
    document.getElementById('status')!.innerText = `${this.anchor}, ${this.head}`;
  }
}
