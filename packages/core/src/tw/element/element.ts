import { IModelNode } from 'tw/model/node';
import { IAttributes } from 'tw/state/token';

export interface IElement {
    buildModelNode<TAttributes extends IAttributes>(
        type: string,
        id: string,
        attributes: TAttributes,
    ): IModelNode<TAttributes>;
}
