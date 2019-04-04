import Token from './Token';
import Transformation from './Transformation';
import Insert from './operations/Insert';
import Delete from './operations/Delete';

type OnUpdatedSubscriber = () => void;

class State {
  protected tokens: Token[];
  protected onUpdatedSubscribers: OnUpdatedSubscriber[];

  constructor() {
    this.tokens = [];
    this.onUpdatedSubscribers = [];
  }

  setTokens(tokens: Token[]) {
    this.tokens = tokens;
    this.onUpdated();
  }

  getTokens(): Token[] {
    return this.tokens;
  }

  subscribeOnUpdated(onUpdatedSubscriber: OnUpdatedSubscriber) {
    this.onUpdatedSubscribers.push(onUpdatedSubscriber);
  }

  applyTransformation(transformation: Transformation) {
    const operations = transformation.getOperations();
    if (operations.length === 0) {
      return;
    }
    operations.forEach(operation => {
      if (operation instanceof Insert) {
        this.tokens.splice(operation.getAt(), 0, ...operation.getTokens());
      } else if (operation instanceof Delete) {
        this.tokens.splice(operation.getFrom(), operation.getTo() - operation.getFrom());
      } else {
        throw new Error('Unknown state transformation operation encountered.');
      }
    });
    this.onUpdated();
  }

  protected onUpdated() {
    this.onUpdatedSubscribers.forEach(onUpdatedSubscriber => {
      onUpdatedSubscriber();
    });
  }
}

export default State;
