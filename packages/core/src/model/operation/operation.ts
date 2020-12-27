import { IDocModelNode } from '../node';
import { IMapping } from './mapping';

export interface IOperation {
    map(mapping: IMapping): IOperation;
    apply(state: IDocModelNode): IOperationResult;
}

export interface IOperationResult {
    readonly change: IOperation;
    readonly reverseOperation: IOperation;
    readonly mapping: IMapping;
}

export abstract class Operation implements IOperation {
    abstract map(mapping: IMapping): IOperation;
    abstract apply(root: IDocModelNode): IOperationResult;
}
