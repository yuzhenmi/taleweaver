import { IComponentService } from 'tw/component/service';
import { IEventListener } from 'tw/event/listener';
import { IModelService } from 'tw/model/service';
import { IService } from 'tw/service/service';
import { IDocRenderNode } from './doc-node';
import { IRenderPosition } from './node';
import { IDidUpdateRenderStateEvent, IRenderState, RenderState } from './state';

export interface IRenderService extends IService {
    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>): void;
    getDocNode(): IDocRenderNode;
    convertOffsetToModelOffset(offset: number): number;
    resolvePosition(offset: number): IRenderPosition;
}

export class RenderService implements IRenderService {
    protected state: IRenderState;

    constructor(componentService: IComponentService, modelService: IModelService) {
        this.state = new RenderState(componentService, modelService);
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        this.state.onDidUpdateRenderState(listener);
    }

    getDocNode() {
        return this.state.getDocNode();
    }

    convertOffsetToModelOffset(offset: number) {
        return this.state.getDocNode().convertOffsetToModelOffset(offset);
    }

    resolvePosition(offset: number) {
        return this.state.getDocNode().resolvePosition(offset);
    }
}
