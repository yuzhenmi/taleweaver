import Token from './Token';
import Transformation from './Transformation';
import Insert from './transformationsteps/Insert';
import Delete from './transformationsteps/Delete';

export interface StateChangedOffsetRange {
  beforeFrom: number;
  beforeTo: number;
  afterFrom: number;
  afterTo: number;
}

type StateSubscriber = (state: State, changedOffsetRanges: StateChangedOffsetRange[]) => void;

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
    const changedOffsetRanges: StateChangedOffsetRange[] = [];
    steps.forEach(step => {
      let changedOffsetRange: StateChangedOffsetRange;
      if (step instanceof Insert) {
        this.tokens.splice(step.getOffset(), 0, ...step.getTokens());
        changedOffsetRange = {
          beforeFrom: step.getOffset(),
          beforeTo: step.getOffset(),
          afterFrom: step.getOffset(),
          afterTo: step.getOffset() + step.getTokens().length - 1,
        };
      } else if (step instanceof Delete) {
        this.tokens.splice(step.getOffsetFrom(), step.getOffsetTo() - step.getOffsetFrom() + 1);
        changedOffsetRange = {
          beforeFrom: step.getOffsetFrom(),
          beforeTo: step.getOffsetTo(),
          afterFrom: step.getOffsetFrom(),
          afterTo: step.getOffsetFrom(),
        };
      } else {
        throw new Error('Unrecognized transformation step.');
      }
      // Adjust all previous changed offset ranges
      // TODO
    });
    this.subscribers.forEach(subscriber => {
      subscriber(this, changedOffsetRanges);
    });
  }
}

export default State;
