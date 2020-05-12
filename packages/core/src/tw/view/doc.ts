import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewDoc<TStyle> extends IViewNode<TStyle> {
    attach(domContainer: HTMLElement): void;
}

export abstract class ViewDoc<TStyle> extends ViewNode<TStyle> implements IViewDoc<TStyle> {
    protected attached = false;

    get type(): IViewNodeType {
        return 'doc';
    }

    get root() {
        return true;
    }

    get leaf() {
        return false;
    }

    attach(domContainer: HTMLElement) {
        if (this.attached) {
            throw new Error('Already attached to the DOM.');
        }
        domContainer.appendChild(this.domContainer);
        this.attached = true;
    }
}
