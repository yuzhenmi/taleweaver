abstract class Node {
  protected id?: string;
  protected size: number;
  protected selectableSize: number;
  protected version: number;

  constructor() {
    this.size = 2;
    this.selectableSize = 0;
    this.version = 0;
  }

  abstract getType(): string;

  setID(id: string) {
    this.id = id;
  }

  getID(): string {
    return this.id!;
  }

  getSize(): number {
    return this.size;
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }
};

export default Node;
