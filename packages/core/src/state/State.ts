import Token from './Token';
import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';
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
    let delta = 0;
    operations.forEach(operation => {
      operation.offsetBy(delta);
      if (operation instanceof Insert) {
        this.tokens.splice(operation.getAt(), 0, ...operation.getTokens());
      } else if (operation instanceof Delete) {
        this.tokens.splice(operation.getFrom(), operation.getTo() - operation.getFrom());
        // Delete surrounding tokens if they are open / close tags without content
        while (this.tokens[operation.getFrom() - 1] instanceof OpenTagToken && this.tokens[operation.getFrom()] instanceof CloseTagToken) {
          this.tokens.splice(operation.getFrom() - 1, 2);
        }
      } else {
        throw new Error('Unknown state transformation operation encountered.');
      }
      delta += operation.getDelta();
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
