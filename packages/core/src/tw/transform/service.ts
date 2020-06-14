import { IComponentService } from '../component/service';
import { ICursorService } from '../cursor/service';
import { ILayoutService } from '../layout/service';
import { IModelService } from '../model/service';
import { IRenderService } from '../render/service';
import { ITransformation, ITransformationResult } from './transformation';

export interface ITransformService {
    applyTransformation(tn: ITransformation): ITransformationResult;
}

export class TransformService {
    constructor(
        protected modelService: IModelService,
        protected componentService: IComponentService,
        protected cursorService: ICursorService,
        protected renderService: IRenderService,
        protected layoutService: ILayoutService,
    ) {}

    applyTransformation(tn: ITransformation) {
        return tn.apply(
            this.modelService.getRoot(),
            this.componentService,
            this.cursorService,
            this.renderService,
            this.layoutService,
        );
    }
}
