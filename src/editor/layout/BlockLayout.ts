import PageLayout from './PageLayout';
import LineLayout from './LineLayout';

export default interface BlockLayout {
  getType(): string;
  getSize(): number;
  getPageLayout(): PageLayout;
  getWidth(): number;
  getHeight(): number;
  getLineLayouts(): LineLayout[];
  getLineLayoutAt(position: number): LineLayout | null;
}
