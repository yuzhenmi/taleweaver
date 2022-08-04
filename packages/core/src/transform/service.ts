import { ComponentService } from '../component/service';
import { CursorService } from '../cursor/service';
import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { LayoutService } from '../layout/service';
import { ModelService } from '../model/service';
import { RenderService } from '../render/service';
import { Transformation, TransformationResult } from './transformation';

export interface DidApplyTransformationEvent {
    result: TransformationResult;
}

export class TransformService {
    protected didApplyTransformationEventEmitter = new EventEmitter<DidApplyTransformationEvent>();

    constructor(
        protected modelService: ModelService,
        protected componentService: ComponentService,
        protected cursorService: CursorService,
        protected renderService: RenderService,
        protected layoutService: LayoutService,
    ) {}

    applyTransformation(tn: Transformation) {
        const result = tn.apply(this.modelService, this.cursorService, this.layoutService);
        this.didApplyTransformationEventEmitter.emit({ result });
        return result;
    }

    onDidApplyTransformation(listener: EventListener<DidApplyTransformationEvent>) {
        return this.didApplyTransformationEventEmitter.on(listener);
    }
}
