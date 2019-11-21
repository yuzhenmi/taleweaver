import { Component, IComponent } from 'tw/component/component';
import { InlineModelNode } from 'tw/model/inline-node';
import { IAttributes } from 'tw/state/token';
import { generateId } from 'tw/util/id';

export interface ITextAttributes extends IAttributes {}

export class TextModelNode extends InlineModelNode<ITextAttributes> {
    getComponentId() {
        return 'text';
    }

    getType() {
        return '';
    }

    toHTML(from: number, to: number) {
        const $component = document.createElement('span');
        $component.innerText = this.content.substring(from - 1, to - 1);
        return $component;
    }

    clone() {
        return new TextModelNode(this.component, generateId(), this.attributes);
    }
}

export class TextComponent extends Component implements IComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): TextModelNode {
        return new TextModelNode(this, id, attributes);
    }
}
