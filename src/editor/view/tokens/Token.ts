import { ReactNode } from 'react';
import BlockElement from '../../model/BlockElement';
import InlineElement from '../../model/InlineElement';

export default interface Token {
  getBlockElement(): BlockElement;
  getInlineElement(): InlineElement;
  getWidth(): number;
  getHeight(): number;
  render(): ReactNode;
}
