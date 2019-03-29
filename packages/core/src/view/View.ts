import LayoutNode from '../layout/LayoutNode';

export default abstract class View {
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

  abstract getDOMContainer(): HTMLElement;

  abstract onRender(layoutNode: LayoutNode): void;
}
