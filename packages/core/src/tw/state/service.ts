import { ICursorService } from 'tw/cursor/service';
import { IEventListener } from 'tw/event/listener';
import { IService } from 'tw/service/service';
import { IToken } from 'tw/state/token';
import { IAppliedTransformation, ITransformation } from 'tw/state/transformation';
import { IDidUpdateStateEvent, IState, State } from './state';

export interface IStateService extends IService {
    onDidUpdateState(listener: IEventListener<IDidUpdateStateEvent>): void;
    getTokens(): IToken[];
    applyTransformations(transformations: ITransformation[]): IAppliedTransformation[];
    applyTransformation(transformation: ITransformation): IAppliedTransformation;
    unapplyTransformations(appliedTransformations: IAppliedTransformation[]): void;
    unapplyTransformation(appliedTransformation: IAppliedTransformation): void;
}

export class StateService implements IStateService {
    protected state: IState;

    constructor(initialMarkup: string, cursorService: ICursorService) {
        this.state = new State(cursorService, initialMarkup);
    }

    onDidUpdateState(listener: IEventListener<IDidUpdateStateEvent>) {
        this.state.onDidUpdateState(listener);
    }

    getTokens() {
        return this.state.getTokens();
    }

    applyTransformations(transformations: ITransformation[]) {
        const appliedTransformations = this.state.applyTransformations(transformations);
        return appliedTransformations;
    }

    applyTransformation(transformation: ITransformation) {
        const [appliedTransformation] = this.state.applyTransformations([transformation]);
        return appliedTransformation;
    }

    unapplyTransformations(appliedTransformations: IAppliedTransformation[]) {
        this.state.unapplyTransformations(appliedTransformations);
    }

    unapplyTransformation(appliedTransformation: IAppliedTransformation) {
        return this.state.unapplyTransformations([appliedTransformation]);
    }
}
