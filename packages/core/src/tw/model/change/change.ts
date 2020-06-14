import { IComponentService } from '../../component/service';
import { IModelRoot } from '../root';
import { IMapping } from './mapping';

export interface IModelChange {
    readonly type: 'model';

    map(mapping: IMapping): IModelChange;
    apply(root: IModelRoot<any>, componentService: IComponentService): IModelChangeResult;
}

export interface IModelChangeResult {
    readonly change: IModelChange;
    readonly reverseChange: IModelChange;
    readonly mapping: IMapping;
}

export abstract class ModelChange implements IModelChange {
    readonly type = 'model';

    abstract map(mapping: IMapping): IModelChange;
    abstract apply(root: IModelRoot<any>, componentService: IComponentService): IModelChangeResult;
}
