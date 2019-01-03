import Element from '../Element';
import Block from '../block/Block';
import LineLayout from '../../layout/LineLayout';
import BoxLayout from '../../layout/BoxLayout';

export default interface Inline extends Element {
  getType(): string;
  getBlock(): Block;
  buildBoxLayouts(lineLayout: LineLayout): BoxLayout[];
}

export type InlineClass = new (block: Block, content: string) => Inline;
