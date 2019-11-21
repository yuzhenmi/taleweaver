import { IModelNode } from 'tw/model/node';
import { IAttributes } from 'tw/state/token';

export interface IComponent {
    getId(): string;

    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): IModelNode<IAttributes>;
}

export abstract class Component {
    constructor(protected id: string) {}

    getId() {
        return this.id;
    }
}
