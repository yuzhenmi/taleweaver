import { IConfigService } from '../../config/service';
import { IDOMService } from '../../dom/service';
import { IViewNode } from '../../view/node';
import { ViewPage as AbstractViewPage } from '../../view/page';
import { IPageComponent, PageComponent as AbstractPageComponent } from '../page-component';

export class ViewPage extends AbstractViewPage {
    readonly domContainer: HTMLDivElement;
    readonly domContentContainer: HTMLDivElement;

    constructor(
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
        super(componentId, layoutId, children, domService);
        this.domContainer = domService.createElement('div');
        this.domContainer.style.position = 'relative';
        this.domContainer.style.marginLeft = 'auto';
        this.domContainer.style.marginRight = 'auto';
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
        this.domContentContainer = domService.createElement('div');
        this.domContainer.appendChild(this.domContentContainer);
    }

    get partId() {
        return 'page';
    }
}

export class PageComponent extends AbstractPageComponent implements IPageComponent {
    constructor(id: string, domService: IDOMService, protected configService: IConfigService) {
        super(id, domService);
    }
    buildViewNode(
        layoutId: string,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        return new ViewPage(
            this.id,
            layoutId,
            children,
            width,
            height,
            paddingTop,
            paddingBottom,
            paddingLeft,
            paddingRight,
            this.domService,
        );
    }
}
