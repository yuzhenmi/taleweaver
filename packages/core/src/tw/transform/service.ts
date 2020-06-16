import { IComponentService } from '../component/service';
import { ICursorService } from '../cursor/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { ILayoutService } from '../layout/service';
import { IModelService } from '../model/service';
import { IRenderService } from '../render/service';
import { ITransformation, ITransformationResult } from './transformation';

export interface IDidApplyTransformationEvent {
    result: ITransformationResult;
}

export interface ITransformService {
    applyTransformation(tn: ITransformation): ITransformationResult;
    onDidApplyTransformation: IOnEvent<IDidApplyTransformationEvent>;
}

export class TransformService implements ITransformService {
    protected didApplyTransformationEventEmitter = new EventEmitter<IDidApplyTransformationEvent>();

    constructor(
        protected modelService: IModelService,
        protected componentService: IComponentService,
        protected cursorService: ICursorService,
        protected renderService: IRenderService,
        protected layoutService: ILayoutService,
    ) {}

    applyTransformation(tn: ITransformation) {
        const result = tn.apply(this.modelService, this.cursorService, this.renderService, this.layoutService);
        this.didApplyTransformationEventEmitter.emit({ result });
        return result;
    }

    onDidApplyTransformation(listener: IEventListener<IDidApplyTransformationEvent>) {
        return this.didApplyTransformationEventEmitter.on(listener);
    }
}
