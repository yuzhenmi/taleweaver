import Token from './Token';
import Transformation from './Transformation';
import Insert from './transformationsteps/Insert';
import Delete from './transformationsteps/Delete';

type StateSubscriber = (state: State) => void;

class State {
  protected tokens: Token[];
  protected subscribers: StateSubscriber[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.subscribers = [];
  }

  getTokens(): Token[] {
    return this.tokens;
  }

  subscribe(subscriber: StateSubscriber) {
    this.subscribers.push(subscriber);
  }

  transform(transformation: Transformation) {
    const steps = transformation.getSteps();
    steps.forEach(step => {
      if (step instanceof Insert) {
        this.tokens.splice(step.getOffset(), 0, ...step.getTokens());
      } else if (step instanceof Delete) {
        this.tokens.splice(step.getOffsetFrom(), step.getOffsetTo() - step.getOffsetFrom() + 1);
      } else {
        throw new Error('Unrecognized transformation step.');
      }
    });
    this.subscribers.forEach(subscriber => {
      subscriber(this);
    });
  }
}

export default State;
