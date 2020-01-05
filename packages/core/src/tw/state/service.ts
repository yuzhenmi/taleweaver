import { ICursorService } from '../cursor/service';
import { IEventListener } from '../event/listener';
import { IDidApplyTransformation, IDidUpdateStateEvent, IState, State } from './state';
import { IToken } from './token';
import { IAppliedTransformation, ITransformation } from './transformation';

export interface IStateService {
    onDidApplyTransformation(listener: IEventListener<IDidApplyTransformation>): void;
    onDidUpdateState(listener: IEventListener<IDidUpdateStateEvent>): void;
    getTokens(): IToken[];
    applyTransformations(transformations: ITransformation[]): IAppliedTransformation[];
    applyTransformation(transformation: ITransformation): IAppliedTransformation;
    unapplyTransformations(appliedTransformations: IAppliedTransformation[]): void;
    unapplyTransformation(appliedTransformation: IAppliedTransformation): void;
}

export class StateService implements IStateService {
    protected state: IState;

    constructor(cursorService: ICursorService, initialMarkup: string) {
        this.state = new State(cursorService, initialMarkup);
    }

    onDidApplyTransformation(listener: IEventListener<IDidApplyTransformation>) {
        this.state.onDidApplyTransformation(listener);
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
