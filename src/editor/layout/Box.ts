import { ReactNode } from 'react';

export default interface Box {
  getWidth(): number;
  getHeight(): number;
  render(): ReactNode;
}
