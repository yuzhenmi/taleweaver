import { IModelNode } from 'tw/model/node';
import { IAttributes } from 'tw/state/token';

export interface IElement {
    buildModelNode(type: string, id: string, attributes: IAttributes): IModelNode<IAttributes>;
}
