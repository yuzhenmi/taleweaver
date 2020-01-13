import { IPageLayoutNode } from '../layout/page-node';
import { IComponent } from './component';

export interface IPageComponent extends IComponent {
    buildPageLayoutNode(): IPageLayoutNode;
}
