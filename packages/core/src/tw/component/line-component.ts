import { ILayoutLine } from '../layout/line';
import { IComponent } from './component';

export interface ILineComponent extends IComponent {
    buildLineLayoutNode(): ILayoutLine;
}
