import Element from './Element';
import BlockElement from './BlockElement';
import Box from '../layout/Box';

export default interface InlineElement extends Element {
  getBlockElement(): BlockElement;
  getPositionInBlock(): number;
  getBoxes(lineWidth: number): Box[];
}
