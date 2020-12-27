import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IMarkService } from '../mark/service';
import { IModelService } from '../model/service';
import { IDocRenderNode } from './node';
import { IDidUpdateRenderStateEvent, RenderState } from './state';

export interface IRenderService {
    getDoc(): IDocRenderNode;
    onDidUpdateRenderState(
        listener: IEventListener<IDidUpdateRenderStateEvent>,
    ): void;
}

export class RenderService implements IRenderService {
    protected state: RenderState;

    constructor(
        modelService: IModelService,
        componentService: IComponentService,
        markService: IMarkService,
    ) {
        this.state = new RenderState(
            modelService,
            componentService,
            markService,
        );
    }

    getDoc() {
        return this.state.doc;
    }

    onDidUpdateRenderState(
        listener: IEventListener<IDidUpdateRenderStateEvent>,
    ) {
        this.state.onDidUpdate(listener);
    }
}
