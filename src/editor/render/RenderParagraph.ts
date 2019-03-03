import RenderBlock, { Parent } from './RenderBlock';
import Paragraph from '../model/Paragraph';

export default class RenderParagraph extends RenderBlock {
  protected node: Paragraph;

  constructor(parent: Parent, node: Paragraph) {
    super(parent, node.getID(), node.getSize(), node.getSelectableSize());
    this.node = node;
  }
}
