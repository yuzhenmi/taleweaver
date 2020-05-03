import { ILayoutPage } from '../layout/page';
import { IComponent } from './component';

export interface IPageComponent extends IComponent {
    buildPageLayoutNode(): ILayoutPage;
}
