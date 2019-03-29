export default abstract class LayoutNode {
  protected id: string;
  protected version: number;

  constructor(id: string) {
    this.id = id;
    this.version = 0;
  }

  getID(): string {
    return this.id;
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }

  abstract getSelectableSize(): number;

  abstract setParent(parent: LayoutNode): void;

  abstract getParent(): LayoutNode;

  abstract getChildren(): LayoutNode[];

  abstract insertChild(child: LayoutNode, offset: number): void;

  abstract deleteChild(child: LayoutNode): void;
}
