import { ReactNode } from 'react';
import Line from './Line';

export default interface Block {
  getSize(): number;
  getWidth(): number;
  getHeight(): number;
  getLines(): Line[];
  render(): ReactNode;
}
