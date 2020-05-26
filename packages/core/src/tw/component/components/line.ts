import { ViewLine as AbstractViewLine } from '../../view/line';
import { IViewNode } from '../../view/node';
import { ILineComponent, LineComponent as AbstractLineComponent } from '../line-component';

export class ViewLine extends AbstractViewLine {
    readonly domContainer = document.createElement('div');

    constructor(
        componentId: string | null,
        layoutId: string,
        children: IViewNode<any>[],
        protected width: number,
        protected height: number,
        protected paddingTop: number,
        protected paddingBottom: number,
        protected paddingLeft: number,
        protected paddingRight: number,
    ) {
        super(componentId, layoutId, children);
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
    }

    get partId() {
        return 'doc';
    }

    get domContentContainer() {
        return this.domContainer;
    }
}

export class LineComponent extends AbstractLineComponent implements ILineComponent {
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
        return new ViewLine(
            this.id,
            layoutId,
            children,
            width,
            height,
            paddingTop,
            paddingBottom,
            paddingLeft,
            paddingRight,
        );
    }
}
