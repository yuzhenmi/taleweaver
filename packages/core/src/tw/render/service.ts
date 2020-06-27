import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IModelService } from '../model/service';
import { IRenderDoc } from './doc';
import { IRenderNode, IRenderPosition } from './node';
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
    convertOffsetToModelOffset(offset: number): number;
    convertModelOffsetToOffset(modelOffset: number): number;
    resolvePosition(offset: number): IRenderPosition;
    getStylesBetween(from: number, to: number): IStyles;
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

    convertOffsetToModelOffset(offset: number) {
        return this.state.doc.convertOffsetToModelOffset(offset);
    }

    convertModelOffsetToOffset(modelOffset: number) {
        return this.state.doc.convertModelOffsetToOffset(modelOffset);
    }

    resolvePosition(offset: number) {
        return this.state.doc.resolvePosition(offset);
    }

    getStylesBetween(from: number, to: number) {
        const styles: IStyles = {};
        const doc = this.state.doc;
        if (from === to) {
            if (from === 0) {
                this.extractStyle(styles, doc, from, to + 1);
            } else {
                this.extractStyle(styles, doc, from - 1, to);
            }
        } else {
            this.extractStyle(styles, doc, from, to);
        }
        return styles;
    }

    protected extractStyle(styles: IStyles, node: IRenderNode<any, any>, from: number, to: number) {
        if (from > to) {
            return;
        }
        const componentStyles = (styles[node.componentId] = styles[node.componentId] || {});
        const partStyles = (componentStyles[node.partId || ''] = componentStyles[node.partId || ''] || []);
        partStyles.push(node.style);
        let cumulatedOffset = 0;
        node.children.forEach((child) => {
            const childSize = child.size;
            if (to > cumulatedOffset && from < cumulatedOffset + childSize) {
                const childFrom = Math.max(0, Math.min(childSize, from - cumulatedOffset));
                const childTo = Math.max(0, Math.min(childSize, to - cumulatedOffset));
                this.extractStyle(styles, child, childFrom, childTo);
            }
            cumulatedOffset += childSize;
        });
    }
}
