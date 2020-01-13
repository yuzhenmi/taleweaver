import { ILineLayoutNode } from '../layout/line-node';
import { IComponent } from './component';

export interface ILineComponent extends IComponent {
    buildLineLayoutNode(): ILineLayoutNode;
}
