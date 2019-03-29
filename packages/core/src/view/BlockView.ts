import View from './View';
import LineView from './LineView';

export type Child = LineView;

export default abstract class BlockView extends View {

  abstract insertChild(child: LineView, offset: number): void;

  abstract deleteChild(child: Child): void;

  abstract getChildren(): Child[];
}
