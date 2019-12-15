import { IComponent } from 'tw/component/component';
import { IPageLayoutNode } from 'tw/layout/page-node';

export interface IPageComponent extends IComponent {
    buildPageLayoutNode(): IPageLayoutNode;
}
