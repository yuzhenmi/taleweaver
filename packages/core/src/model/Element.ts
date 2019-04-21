import Node from '../tree/Node';
import Attributes from '../state/Attributes';

export default abstract class Element implements Node {
  protected id?: string;
  protected version: number = 0;
  protected size?: number;

  abstract getType(): string;

  setID(id: string) {
    this.id = id;
  }

  getID() {
    if (!this.id) {
      throw new Error('No ID has been set.');
    }
    return this.id;
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }

  abstract getSize(): number;

  abstract getAttributes(): Attributes;

  abstract onStateUpdated(attributes: Attributes): boolean;

  protected clearCache() {
    this.size = undefined;
  }
}
