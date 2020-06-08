import { IComponentService } from '../../component/service';
import { IModelRoot } from '../root';
import { IMapping } from './mapping';

export interface IChange {
    apply(root: IModelRoot<any>, mappings: IMapping[], componentService: IComponentService): IChangeResult;
}

export interface IChangeResult {
    readonly change: IChange;
    readonly reverseChange: IChange;
    readonly mapping: IMapping;
}
