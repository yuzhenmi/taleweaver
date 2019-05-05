import LayoutNode from './LayoutNode';
import generateID from '../utils/generateID';

export default abstract class FlowBox extends LayoutNode {

  constructor() {
    super(generateID());
  }
}
