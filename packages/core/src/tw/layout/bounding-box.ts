import { IRenderPosition } from '../render/position';
import { ILayoutNode } from './node';

export interface IBoundingBox {
    from: IRenderPosition;
    to: IRenderPosition;
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
