import { ViewLine as AbstractViewLine } from '../../view/line';
import { ILineComponent, LineComponent as AbstractLineComponent } from '../line-component';

export class ViewLine extends AbstractViewLine<null> {
    readonly domContainer = document.createElement('div');

    get partId() {
        return 'doc';
    }

    get domContentContainer() {
        return this.domContainer;
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
        super.update(text, width, height, paddingTop, paddingBottom, paddingLeft, paddingRight, null);
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
    }
}

export class LineComponent extends AbstractLineComponent implements ILineComponent {
    buildViewNode(layoutId: string) {
        return new ViewLine(this.id, layoutId);
    }
}
