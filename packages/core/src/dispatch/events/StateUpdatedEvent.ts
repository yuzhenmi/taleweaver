import Event from '../Event';

class StateUpdatedEvent extends Event {
  protected beforeFrom: number;
  protected beforeTo: number;
  protected afterFrom: number;
  protected afterTo: number;

  static getType() {
    return 'StateUpdated';
  }

  constructor(beforeFrom: number, beforeTo: number, afterFrom: number, afterTo: number) {
    super();
    this.beforeFrom = beforeFrom;
    this.beforeTo = beforeTo;
    this.afterFrom = afterFrom;
    this.afterTo = afterTo;
  }
}

export default StateUpdatedEvent;
