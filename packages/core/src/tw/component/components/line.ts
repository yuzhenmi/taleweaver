import { IDOMService } from '../../dom/service';
import { ViewLine as AbstractViewLine } from '../../view/line';
import { IViewNode } from '../../view/node';
import { ILineComponent, LineComponent as AbstractLineComponent } from '../line-component';

export class ViewLine extends AbstractViewLine {
    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        layoutId: string,
        children: IViewNode<any>[],
        protected width: number,
        protected height: number,
        protected paddingTop: number,
        protected paddingBottom: number,
        protected paddingLeft: number,
        protected paddingRight: number,
        domService: IDOMService,
    ) {
        super(domContainer, componentId, layoutId, children, domService);
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
        this.domContainer.innerHTML = '';
        children.map((child) => this.domContainer.appendChild(child.domContainer));
    }

    get partId() {
        return 'line';
    }

    get domContentContainer() {
        return this.domContainer;
    }
}

export class LineComponent extends AbstractLineComponent implements ILineComponent {
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
        return new ViewLine(
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
