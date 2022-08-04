import { ComponentService } from '../component/service';
import { EventListener } from '../event/listener';
import { MarkService } from '../mark/service';
import { ModelService } from '../model/service';
import { DidUpdateRenderStateEvent, RenderState } from './state';

export class RenderService implements RenderService {
    protected state: RenderState;

    constructor(modelService: ModelService, componentService: ComponentService, markService: MarkService) {
        this.state = new RenderState(modelService, componentService, markService);
    }

    getDoc() {
        return this.state.doc;
    }

    onDidUpdateRenderState(listener: EventListener<DidUpdateRenderStateEvent>) {
        this.state.onDidUpdate(listener);
    }
}
