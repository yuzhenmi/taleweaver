import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IModelPosition } from '../model/position';
import { IModelService } from '../model/service';
import { IFont } from '../text/service';
import { IRenderDoc } from './doc';
import { IRenderNode } from './node';
import { IRenderPosition, IResolvedRenderPosition } from './position';
import { IDidUpdateRenderStateEvent, IRenderState, RenderState } from './state';
import { IRenderText } from './text';

export type IResolvedFont = {
    [TKey in keyof IFont]: IFont[TKey] | null;
};

export interface IRenderService {
    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>): void;
    getDoc(): IRenderDoc<any, any>;
    getDocSize(): number;
    resolvePosition(position: IRenderPosition): IResolvedRenderPosition;
    resolveFont(from: IRenderPosition, to: IRenderPosition): IResolvedFont;
    convertModelToRenderPosition(modelPosition: IModelPosition): IRenderPosition;
    convertRenderToModelPosition(renderPosition: IRenderPosition): IModelPosition;
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

    resolveFont(from: IRenderPosition, to: IRenderPosition) {
        const resolvedFont: Partial<IResolvedFont> = {};
        const nodeQueue: [IRenderNode<any, any>, number][] = [[this.state.doc, 0]];
        while (nodeQueue.length > 0) {
            const [node, nodeFrom] = nodeQueue.shift()!;
            if (node.text) {
                const nodeFont = (node as IRenderText<any, any>).font;
                let fontProp: keyof IFont;
                for (fontProp in nodeFont) {
                    if (!(fontProp in resolvedFont)) {
                        (resolvedFont as any)[fontProp] = nodeFont[fontProp];
                    } else if (resolvedFont[fontProp] !== nodeFont[fontProp]) {
                        resolvedFont[fontProp] = null;
                    }
                }
            } else {
                let childOffset = 0;
                node.children.forEach((child, childIndex) => {
                    const childSize = child.size;
                    const childFrom = nodeFrom + childOffset;
                    const childTo = childFrom + childSize;
                    let intersect: boolean;
                    if (from === to) {
                        intersect = childFrom <= to && childTo > from;
                    } else {
                        intersect = childFrom < to && childTo > from;
                    }
                    if (intersect) {
                        nodeQueue.push([child, childFrom]);
                    }
                    childOffset += childSize;
                });
            }
        }
        return {
            weight: resolvedFont.weight ?? null,
            size: resolvedFont.size ?? null,
            family: resolvedFont.family ?? null,
            letterSpacing: resolvedFont.letterSpacing ?? null,
            underline: resolvedFont.underline ?? null,
            italic: resolvedFont.italic ?? null,
            strikethrough: resolvedFont.strikethrough ?? null,
            color: resolvedFont.color ?? null,
        };
    }

    convertModelToRenderPosition(modelPosition: IModelPosition) {
        return this.state.doc.convertModelToRenderPosition(modelPosition);
    }

    convertRenderToModelPosition(renderPosition: IRenderPosition) {
        return this.state.doc.convertRenderToModelPosition(renderPosition);
    }
}
