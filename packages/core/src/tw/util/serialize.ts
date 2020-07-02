import { ComponentService } from '../component/service';
import { IExternalConfig } from '../config/config';
import { ConfigService } from '../config/service';
import { buildBaseConfig } from '../config/util';
import { IModelNode } from '../model/node';
import { IModelRoot } from '../model/root';
import { ServiceRegistry } from '../service/registry';

export interface INode {
    componentId: string;
    partId: string | null;
    id: string;
    text: string;
    attributes: any;
    children: INode[];
}

export function parse(node: INode, config: IExternalConfig): IModelRoot<any> {
    const serviceRegistry = new ServiceRegistry();
    const configService = new ConfigService(buildBaseConfig(), config);
    const componentService = new ComponentService(configService, serviceRegistry);

    function internalParse(node: INode): IModelNode<any> {
        return componentService.getComponent(node.componentId).buildModelNode(
            node.partId,
            node.id,
            node.text,
            node.attributes,
            node.children.map((child) => internalParse(child)),
        );
    }
    return internalParse(node);
}
