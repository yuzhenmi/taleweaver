import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IModelService } from '../model/service';
import { IService } from '../service/service';
import { IDocRenderNode } from './doc-node';
import { IRenderNode, IRenderPosition, IStyle } from './node';
import { IDidUpdateRenderStateEvent, IRenderState, RenderState } from './state';

export interface IStyles {
    [componentId: string]: {
        [partId: string]: IStyle[];
    };
}

export interface IRenderService extends IService {
    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>): void;
    getDocNode(): IDocRenderNode;
    convertOffsetToModelOffset(offset: number): number;
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

    getDocNode() {
        return this.state.getDocNode();
    }

    convertOffsetToModelOffset(offset: number) {
        return this.state.getDocNode().convertOffsetToModelOffset(offset);
    }

    resolvePosition(offset: number) {
        return this.state.getDocNode().resolvePosition(offset);
    }

    getStylesBetween(from: number, to: number) {
        const styles: IStyles = {};
        const docNode = this.state.getDocNode();
        this.extractStyle(styles, docNode, from, to);
        return styles;
    }

    protected extractStyle(styles: IStyles, node: IRenderNode, from: number, to: number) {
        const componentStyles = (styles[node.getComponentId()] = styles[node.getComponentId()] || {});
        const partStyles = (componentStyles[node.getPartId()] = componentStyles[node.getPartId()] || []);
        partStyles.push(node.getStyle());
        let position = 0;
        if (node.isLeaf()) {
            return;
        }
        node.getChildren().forEach(child => {
            const childSize = child.getSize();
            const childFrom = Math.max(0, Math.min(childSize, from - position));
            const childTo = Math.max(0, Math.min(childSize, to - position));
            if (childFrom < childTo) {
                this.extractStyle(styles, child, childFrom, childTo);
            }
            position += childSize;
        });
    }
}
