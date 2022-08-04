import { BaseModelNode, Point } from './base';

export class InlineModelNode<TAttributes> extends BaseModelNode<TAttributes> {
    readonly type = 'inline';
    readonly size = 1;

    pointToOffset(point: Point) {
        if (point.path.length > 0 || point.offset !== 0) {
            throw new Error(`Point ${point.path.join(',')}+${point.offset} is invalid.`);
        }
        return point.offset;
    }

    offsetToPoint(offset: number) {
        if (offset !== 0) {
            throw new Error(`Offset ${offset} is invalid.`);
        }
        return { path: [], offset };
    }
}
