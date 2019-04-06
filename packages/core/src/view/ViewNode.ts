import LayoutNode from '../layout/LayoutNode';

export default abstract class ViewNode {
  protected id: string;

  constructor(id: string) {
    this.id = id;
  }

  getID(): string {
    return this.id;
  }

  abstract getDOMContainer(): HTMLElement;

  abstract onLayoutUpdated(layoutNode: LayoutNode): void;

  abstract onDeleted(): void;
}
