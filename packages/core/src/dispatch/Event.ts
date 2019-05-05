abstract class Event {

  static getType(): string {
    throw new Error('Event does not have getType implemented.');
  }

  getType() {
    // @ts-ignore
    return this.constructor.getType();
  }
}

export default Event;
