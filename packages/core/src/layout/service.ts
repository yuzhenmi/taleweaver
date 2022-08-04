import { EventListener } from '../event/listener';
import { RenderService } from '../render/service';
import { TextService } from '../text/service';
import { LayoutPositionLayerDescription } from './nodes/base';
import { DidUpdateLayoutStateEvent, LayoutState } from './state';

class LayoutPositionDescription {
    protected internalLayers: LayoutPositionLayerDescription[];

    constructor(layers: LayoutPositionLayerDescription[]) {
        this.internalLayers = layers;
    }

    get layers() {
        return this.internalLayers;
    }

    atBlock() {
        for (let n = this.internalLayers.length - 1; n >= 0; n--) {
            const layer = this.internalLayers[n];
            if (layer.node.type === 'block') {
                return layer;
            }
        }
        throw new Error('Could not find block position.');
    }

    atLine() {
        for (let n = this.internalLayers.length - 1; n >= 0; n--) {
            const layer = this.internalLayers[n];
            if (layer.node.type === 'line') {
                return layer;
            }
        }
        throw new Error('Could not find line position.');
    }

    atWord() {
        for (let n = this.internalLayers.length - 1; n >= 0; n--) {
            const layer = this.internalLayers[n];
            if (layer.node.type === 'word' || layer.node.type === 'inline') {
                return layer;
            }
        }
        throw new Error('Could not find line position.');
    }
}

export class LayoutService implements LayoutService {
    protected state: LayoutState;

    constructor(renderService: RenderService, textService: TextService) {
        this.state = new LayoutState(renderService, textService);
    }

    getDoc() {
        return this.state.doc;
    }

    resolveBoundingBoxes(from: number, to: number) {
        return this.state.doc.resolveBoundingBoxes(from, to);
    }

    describePosition(position: number) {
        const layers = this.state.doc.describePosition(position);
        return new LayoutPositionDescription(layers);
    }

    onDidUpdateLayoutState(listener: EventListener<DidUpdateLayoutStateEvent>) {
        this.state.onDidUpdate(listener);
    }
}
