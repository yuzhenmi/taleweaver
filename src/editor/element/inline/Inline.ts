import Element from '../Element';
import Block from '../block/Block';
import BoxLayout from '../../layout/Box';

export default interface Inline extends Element {
  getBlock(): Block;
  getPositionInBlock(): number;
  getBoxLayouts(lineWidth: number): BoxLayout[];
}
