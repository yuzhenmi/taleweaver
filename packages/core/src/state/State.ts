import Token from './Token';
import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';
import Transformation from './Transformation';
import Insert from './operations/Insert';
import Delete from './operations/Delete';
import { OffsetAdjustment } from './Operation';

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
    const offsetAdjustments: OffsetAdjustment[] = [];
    operations.forEach(operation => {
      offsetAdjustments.forEach(offsetAdjustment => operation.adjustOffsetBy(offsetAdjustment));
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
      offsetAdjustments.push(operation.getOffsetAdjustment());
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
