import { IComponentService } from '../../component/service';
import { IModelRoot } from '../root';
import { IMapping } from './mapping';

export interface IModelChange {
    readonly type: 'model';

    apply(root: IModelRoot<any>, mappings: IMapping[], componentService: IComponentService): IModelChangeResult;
}

export interface IModelChangeResult {
    readonly change: IModelChange;
    readonly reverseChange: IModelChange;
    readonly mapping: IMapping;
}

export abstract class ModelChange implements IModelChange {
    readonly type = 'model';

    abstract apply(
        root: IModelRoot<any>,
        mappings: IMapping[],
        componentService: IComponentService,
    ): IModelChangeResult;
}
