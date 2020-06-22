import { IComponentService } from '../component/service';
import { IModelRoot } from '../model/root';

export interface INode {
    componentId: string;
    partId: string | null;
    id: string;
    text: string;
    attributes: any;
    children: INode[];
}

export function parse(node: INode, componentService: IComponentService): IModelRoot<any> {
    return componentService.getComponent(node.componentId).buildModelNode(
        node.partId,
        node.id,
        node.text,
        node.attributes,
        node.children.map((child) => parse(child, componentService)),
    );
}
