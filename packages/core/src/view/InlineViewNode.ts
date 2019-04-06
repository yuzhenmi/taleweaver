import InlineBox from '../layout/InlineBox';
import ViewNode from './ViewNode';

export default abstract class InlineViewNode extends ViewNode {

  abstract onLayoutUpdated(layoutNode: InlineBox): void;

  abstract resolveSelectionOffset(offset: number): number;
}
