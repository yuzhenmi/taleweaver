import { EventListener } from '../event/listener';
import { Point } from './nodes/base';
import { DocModelNode } from './nodes/doc';
import { Operation } from './operation/operation';
import { DidUpdateModelStateEvent, ModelState } from './state';

export class ModelService {
    protected state: ModelState;

    constructor(doc: DocModelNode<any>) {
        this.state = new ModelState(doc);
    }

    getDoc() {
        return this.state.doc;
    }

    getDocSize() {
        return this.state.doc.size;
    }

    pointToOffset(point: Point) {
        return this.state.doc.pointToOffset(point);
    }

    offsetToPoint(offset: number) {
        return this.state.doc.offsetToPoint(offset);
    }

    applyOperation(operation: Operation) {
        return this.state.applyOperation(operation);
    }

    onDidUpdateModelState(listener: EventListener<DidUpdateModelStateEvent>) {
        this.state.onDidUpdate(listener);
    }
}
