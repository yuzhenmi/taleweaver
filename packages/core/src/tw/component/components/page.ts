import { IDOMService } from '../../dom/service';
import { IViewNode } from '../../view/node';
import { ViewPage as AbstractViewPage } from '../../view/page';
import { IPageComponent, PageComponent as AbstractPageComponent } from '../page-component';

export class ViewPage extends AbstractViewPage {
    readonly domContentContainer: HTMLElement;

    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        layoutId: string,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
        domService: IDOMService,
    ) {
        super(domContainer, componentId, layoutId, children, domService);
        this.domContainer.style.position = 'relative';
        this.domContainer.style.marginLeft = 'auto';
        this.domContainer.style.marginRight = 'auto';
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
        this.domContainer.innerHTML = '';
        this.domContentContainer = this.findOrCreateDOMContentContainer();
        this.domContentContainer.setAttribute('data-tw-role', 'content-container');
        children.map((child) => this.domContentContainer.appendChild(child.domContainer));
        this.domContainer.appendChild(this.domContentContainer);
    }

    get partId() {
        return 'page';
    }

    protected findOrCreateDOMContentContainer() {
        for (let n = 0, nn = this.domContainer.children.length; n < nn; n++) {
            const child = this.domContainer.children[n];
            if (child.getAttribute('data-tw-role') === 'content-container') {
                return child as HTMLDivElement;
            }
        }
        return this.domService.createElement('div');
    }
}

export class PageComponent extends AbstractPageComponent implements IPageComponent {
    buildViewNode(
        domContainer: HTMLElement,
        layoutId: string,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        const domService = this.serviceRegistry.getService('dom');
        return new ViewPage(
            domContainer,
            this.id,
            layoutId,
            children,
            width,
            height,
            paddingTop,
            paddingBottom,
            paddingLeft,
            paddingRight,
            domService,
        );
    }
}
