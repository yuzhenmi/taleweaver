export default abstract class LayoutNode {

  abstract getSelectableSize(): number;

  abstract setParent(parent: LayoutNode): void;

  abstract getChildren(): LayoutNode[];

  abstract insertChild(child: LayoutNode, offset: number): void;

  abstract deleteChild(child: LayoutNode): void;
}
