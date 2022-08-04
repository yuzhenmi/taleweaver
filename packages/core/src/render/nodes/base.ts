import { EventEmitter } from '../../event/emitter';
import { EventListener } from '../../event/listener';
import { generateId } from '../../util/id';

export interface DidUpdateRenderNodeEvent {}

export abstract class BaseRenderNode<TStyle> {
    abstract readonly size: number;

    readonly id = generateId();

    protected internalStyle: TStyle;
    protected internalNeedLayout = true;
    protected didUpdateEventEmitter = new EventEmitter<DidUpdateRenderNodeEvent>();

    constructor(defaultStyle: TStyle) {
        this.internalStyle = defaultStyle;
        this.onDidUpdate(() => {
            this.internalNeedLayout = true;
        });
    }

    get style() {
        if (!this.internalStyle) {
            throw new Error('Style is not initialized.');
        }
        return this.internalStyle;
    }

    get needLayout() {
        return this.internalNeedLayout;
    }

    setStyle(style: TStyle) {
        this.internalStyle = style;
        this.didUpdateEventEmitter.emit({});
    }

    markAsLaidOut() {
        this.internalNeedLayout = false;
    }

    onDidUpdate(listener: EventListener<DidUpdateRenderNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}
