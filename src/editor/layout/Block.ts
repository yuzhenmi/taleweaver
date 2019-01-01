import { ReactNode } from 'react';
import Line from './Line';

export default interface Block {
  getWidth(): number;
  getHeight(): number;
  getLines(): Line[];
  render(): ReactNode;
}
