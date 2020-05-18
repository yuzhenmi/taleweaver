import { IConfigService } from '../../config/service';
import { ViewPage as AbstractViewPage } from '../../view/page';
import { IPageComponent, PageComponent as AbstractPageComponent } from '../page-component';

export class ViewPage extends AbstractViewPage<null> {
    readonly domContainer = document.createElement('div');
    readonly domContentContainer = document.createElement('div');

    constructor(componentId: string | null, layoutId: string) {
        super(componentId, layoutId);
        this.domContainer.style.position = 'relative';
        this.domContainer.style.marginLeft = 'auto';
        this.domContainer.style.marginRight = 'auto';
    }

    get partId() {
        return 'page';
    }

    update(
        text: string,
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
    }
}

export class PageComponent extends AbstractPageComponent implements IPageComponent {
    constructor(id: string, protected configService: IConfigService) {
        super(id);
    }
    buildViewNode(layoutId: string) {
        return new ViewPage(this.id, layoutId);
    }
}
