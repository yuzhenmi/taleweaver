import Element from '../Element';
import Block from '../block/Block';
import BoxLayout from '../../layout/Box';

export default interface Inline extends Element {
  getBlock(): Block;
  getBoxLayouts(): BoxLayout[];
  getPositionInBlock(): number;
}
