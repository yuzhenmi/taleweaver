export default interface Event {}

export class KeyPressEvent implements Event {
  public readonly key: string;

  constructor(key: string) {
    this.key = key;
  }
}
