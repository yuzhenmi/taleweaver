export default class RenderNode {
  protected id?: string;
  protected size?: number;
  protected selectableSize?: number;

  getID(): string {
    return this.id!;
  }

  getSize(): number {
    return this.size!;
  }

  getSelectableSize(): number {
    return this.selectableSize!;
  }
}
