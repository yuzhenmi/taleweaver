import { EventEmitter } from '../../event/emitter';
import { EventListener } from '../../event/listener';
import { generateId } from '../../util/id';

export interface DidUpdateViewNodeEvent {}

export abstract class BaseViewNode<TLayout> {
    readonly id = generateId();
    abstract readonly domContainer: HTMLElement;

    protected abstract updateDOMLayout(): void;

    protected internalLayout?: TLayout;
    protected didUpdateEventEmitter = new EventEmitter<DidUpdateViewNodeEvent>();

    constructor(readonly layoutId: string) {}

    get layout() {
        if (!this.internalLayout) {
            throw new Error('Layout is not initialized.');
        }
        return this.internalLayout;
    }

    setLayout(layout: TLayout) {
        this.internalLayout = layout;
        this.updateDOMLayout();
        this.didUpdateEventEmitter.emit({});
    }

    onDidUpdate(listener: EventListener<DidUpdateViewNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}

export function setDOMContainerChildren(domContainer: HTMLElement, children: HTMLElement[]) {
    while (domContainer.lastChild) {
        domContainer.removeChild(domContainer.lastChild);
    }
    for (const child of children) {
        domContainer.appendChild(child);
    }
}
