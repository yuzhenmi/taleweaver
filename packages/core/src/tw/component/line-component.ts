import { IComponent } from 'tw/component/component';
import { ILineLayoutNode } from 'tw/layout/line-node';

export interface ILineComponent extends IComponent {
    buildLineLayoutNode(): ILineLayoutNode;
}
