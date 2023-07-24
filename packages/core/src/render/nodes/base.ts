export interface DidUpdateRenderNodeEvent {}

export abstract class BaseRenderNode<TStyle> {
    abstract readonly size: number;

    protected internalNeedLayout = true;

    constructor(readonly id: string, readonly style: TStyle) {}

    get needLayout() {
        return this.internalNeedLayout;
    }

    markAsLaidOut() {
        this.internalNeedLayout = false;
    }
}
