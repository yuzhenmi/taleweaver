import { IComponent } from './component';

export interface IPageComponent extends IComponent {
    buildView(): IPageView;
}
