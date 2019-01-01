import Element from '../Element';
import Block from '../block/Block';
import BoxLayout from '../../layout/BoxLayout';

export default interface Inline extends Element {
  getType(): string;
  getBlock(): Block;
  getBoxLayouts(): BoxLayout[];
}

export type InlineClass = new (block: Block, content: string) => Inline;
