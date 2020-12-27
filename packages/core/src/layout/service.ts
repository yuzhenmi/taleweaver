import { IEventListener } from '../event/listener';
import { IRenderService } from '../render/service';
import { ITextService } from '../text/service';
import { IBlockLayoutNode } from './block-node';
import { IDocLayoutNode } from './doc-node';
import { IInlineLayoutNode } from './inline-node';
import { ILineLayoutNode } from './line-node';
import { ILayoutPositionLayerDescription, IResolveBoundingBoxesResult } from './node';
import { IDidUpdateLayoutStateEvent, LayoutState } from './state';
import { IWordLayoutNode } from './word-node';

export interface ILayoutPositionDescription {
    readonly layers: ILayoutPositionLayerDescription[];

    atBlock(): ILayoutPositionLayerDescription<IBlockLayoutNode>;
    atLine(): ILayoutPositionLayerDescription<ILineLayoutNode>;
    atWord(): ILayoutPositionLayerDescription<IWordLayoutNode | IInlineLayoutNode>;
}

export interface ILayoutService {
    getDoc(): IDocLayoutNode;
    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult;
    describePosition(position: number): ILayoutPositionDescription;
    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>): void;
}

class LayoutPositionDescription implements ILayoutPositionDescription {
    protected internalLayers: ILayoutPositionLayerDescription[];

    constructor(layers: ILayoutPositionLayerDescription[]) {
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

export class LayoutService implements ILayoutService {
    protected state: LayoutState;

    constructor(renderService: IRenderService, textService: ITextService) {
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

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        this.state.onDidUpdate(listener);
    }
}
