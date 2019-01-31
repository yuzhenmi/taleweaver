/** Observer to cursor state change. */
type CursorObserver = (cursor: Cursor) => void;

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
   * Notifies observers of state change.
   */
  private notifyObservers() {
    this.observers.forEach(observer => {
      observer(this);
    });
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
   * Moves the cursor to a certain position.
   * @param position - Position to move cursor to.
   */
  moveTo(position: number) {
    this.anchor = position;
    this.head = position;
    this.notifyObservers();
  }

  /**
   * Moves the cursor head to a certain position.
   * The anchor is not moved.
   * @param position - Position to move cursor head to.
   */
  moveHeadTo(position: number) {
    this.head = position;
    this.notifyObservers();
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
}
