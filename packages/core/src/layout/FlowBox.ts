import LayoutNode from './LayoutNode';
import generateRandomString from './helpers/generateRandomString';

export default abstract class FlowBox extends LayoutNode {

  constructor() {
    super(generateRandomString());
  }
}
