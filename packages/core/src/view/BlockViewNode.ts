import ViewNode from './ViewNode';
import LineViewNode from './LineViewNode';

export type Child = LineViewNode;

export default abstract class BlockViewNode extends ViewNode {

  abstract insertChild(child: LineViewNode, offset: number): void;

  abstract deleteChild(child: Child): void;

  abstract getChildren(): Child[];
}
