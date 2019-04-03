import LayoutNode from './LayoutNode';
import generateID from '../helpers/generateID';

export default abstract class FlowBox extends LayoutNode {

  constructor() {
    super(generateID());
  }
}
