import { IModelPosition } from '../model/position';
import { ILayoutNode } from './node';

export interface IBoundingBox {
    from: IModelPosition;
    to: IModelPosition;
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface IResolvedBoundingBoxes {
    node: ILayoutNode;
    boundingBoxes: IBoundingBox[];
    children: IResolvedBoundingBoxes[];
}
