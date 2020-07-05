import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IModelPosition } from '../model/position';
import { IModelService } from '../model/service';
import { IRenderDoc } from './doc';
import { IRenderNode } from './node';
import { IRenderPosition, IResolvedRenderPosition } from './position';
import { IDidUpdateRenderStateEvent, IRenderState, RenderState } from './state';

export interface IStyles {
    [componentId: string]: {
        [partId: string]: any[];
    };
}

export interface IRenderService {
    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>): void;
    getDoc(): IRenderDoc<any, any>;
    getDocSize(): number;
    resolvePosition(position: IRenderPosition): IResolvedRenderPosition;
    convertModelToRenderPosition(modelPosition: IModelPosition): IRenderPosition;
    convertRenderToModelPosition(renderPosition: IRenderPosition): IModelPosition;
    getStylesBetween(from: IRenderPosition, to: IRenderPosition): IStyles;
}

export class RenderService implements IRenderService {
    protected state: IRenderState;

    constructor(componentService: IComponentService, modelService: IModelService) {
        this.state = new RenderState(componentService, modelService);
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        this.state.onDidUpdateRenderState(listener);
    }

    getDoc() {
        return this.state.doc;
    }

    getDocSize() {
        return this.state.doc.size;
    }

    resolvePosition(position: IRenderPosition) {
        return this.state.doc.resolvePosition(position);
    }

    convertModelToRenderPosition(modelPosition: IModelPosition) {
        return this.state.doc.convertModelToRenderPosition(modelPosition);
    }

    convertRenderToModelPosition(renderPosition: IRenderPosition) {
        return this.state.doc.convertRenderToModelPosition(renderPosition);
    }

    getStylesBetween(from: IRenderPosition, to: IRenderPosition) {
        const resolvedFrom = this.resolvePosition(from);
        const resolvedTo = this.resolvePosition(to);
        const styles: IStyles = {};
        const doc = this.state.doc;
        this.extractStyle(styles, doc, resolvedFrom, resolvedTo);
        return styles;
    }

    protected extractStyle(
        styles: IStyles,
        node: IRenderNode<any, any>,
        from: IResolvedRenderPosition | null,
        to: IResolvedRenderPosition | null,
    ) {
        const componentStyles = (styles[node.componentId] = styles[node.componentId] || {});
        const partStyles = (componentStyles[node.partId || ''] = componentStyles[node.partId || ''] || []);
        partStyles.push(node.style);
        if (node.leaf) {
            return;
        }
        const fromOffset = from ? from[0].offset : 0;
        const toOffset = to ? to[0].offset : node.contentLength - 1;
        for (let n = fromOffset; n <= toOffset; n++) {
            const child = node.children.at(n);
            this.extractStyle(
                styles,
                child,
                from && n === fromOffset ? from.slice(1) : null,
                to && n === toOffset ? to.slice(1) : null,
            );
        }
    }
}
