import RenderInline, { Parent } from './RenderInline';
import Text from '../model/Text';

export default class RenderText extends RenderInline {
  protected node: Text;

  constructor(parent: Parent, node: Text) {
    super(parent, node.getID());
    this.node = node;
  }
}
