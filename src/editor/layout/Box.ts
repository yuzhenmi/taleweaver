import { ReactNode } from 'react';

export default interface Box {
  getSize(): number;
  getWidth(): number;
  getHeight(): number;
  render(): ReactNode;
}
