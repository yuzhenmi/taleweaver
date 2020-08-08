import { IComponentService } from '../../component/service';
import { IModelRoot } from '../root';
import { IMapping } from './mapping';

export interface IChange {
    map(mapping: IMapping): IChange;
    apply(state: IModelRoot<any>, componentService: IComponentService): IChangeResult;
}

export interface IChangeResult {
    readonly change: IChange;
    readonly reverseChange: IChange;
    readonly mapping: IMapping;
}

export abstract class ModelChange implements IChange {
    abstract map(mapping: IMapping): IChange;
    abstract apply(root: IModelRoot<any>, componentService: IComponentService): IChangeResult;
}
