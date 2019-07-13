import Event from '../Event';

class StateUpdatedEvent extends Event {
  static getType() {
    return 'StateUpdated';
  }

  protected beforeFrom: number;
  protected beforeTo: number;
  protected afterFrom: number;
  protected afterTo: number;

  constructor(
    beforeFrom: number,
    beforeTo: number,
    afterFrom: number,
    afterTo: number,
  ) {
    super();
    this.beforeFrom = beforeFrom;
    this.beforeTo = beforeTo;
    this.afterFrom = afterFrom;
    this.afterTo = afterTo;
  }

  getBeforeFrom() {
    return this.beforeFrom;
  }

  getBeforeTo() {
    return this.beforeTo;
  }

  getAfterFrom() {
    return this.afterFrom;
  }

  getAfterTo() {
    return this.afterTo;
  }
}

export default StateUpdatedEvent;
