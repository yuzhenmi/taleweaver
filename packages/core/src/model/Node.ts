abstract class Node {
  protected id?: string;
  protected size: number;
  protected selectableSize: number;

  constructor() {
    this.size = 2;
    this.selectableSize = 0;
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
};

export default Node;
