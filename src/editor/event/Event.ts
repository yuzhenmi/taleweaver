export default interface Event {}

export class KeyPressEvent implements Event {
  public readonly key: string;
  public readonly shift: boolean;
  public readonly meta: boolean;
  public readonly alt: boolean;

  constructor(key: string, shift: boolean, meta: boolean, alt: boolean) {
    this.key = key;
    this.shift = shift;
    this.meta = meta;
    this.alt = alt;
  }
}
