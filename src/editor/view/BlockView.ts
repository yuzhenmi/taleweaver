import View from './View';
import LineView from './LineView';

export default abstract class BlockView extends View {

  abstract insertChild(child: BlockView | LineView, offset: number): void;
}
