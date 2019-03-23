import Token from './Token';
import Transformation from './Transformation';
import Insert from './operations/Insert';
import Delete from './operations/Delete';

type StateSubscriber = (tokens: Token[]) => void;

class State {
  protected tokens: Token[];
  protected subscribers: StateSubscriber[];

  constructor() {
    this.tokens = [];
    this.subscribers = [];
  }

  setTokens(tokens: Token[]) {
    this.tokens = tokens;
    this.subscribers.forEach(subscriber => {
      subscriber(this.tokens);
    });
  }

  getTokens(): Token[] {
    return this.tokens;
  }

  subscribe(subscriber: StateSubscriber) {
    this.subscribers.push(subscriber);
  }

  applyTransformation(transformation: Transformation) {
    const operations = transformation.getOperations();
    operations.forEach(operation => {
      if (operation instanceof Insert) {
        this.tokens.splice(operation.getAt(), 0, ...operation.getTokens());
      } else if (operation instanceof Delete) {
        this.tokens.splice(operation.getFrom(), operation.getTo() - operation.getFrom() + 1);
      } else {
        throw new Error('Unknown state transformation operation encountered.');
      }
    });
    this.subscribers.forEach(subscriber => {
      subscriber(this.tokens);
    });
  }
}

export default State;
