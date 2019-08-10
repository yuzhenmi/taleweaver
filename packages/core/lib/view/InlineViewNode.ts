import LineNode from './LineViewNode';
import ViewNode from './ViewNode';

export type ParentNode = LineNode;

export default abstract class InlineViewNode extends ViewNode<ParentNode, never> {

    isRoot() {
        return false;
    }

    isLeaf() {
        return true;
    }

    appendDOMChild(domChild: HTMLElement) { }

    insertDOMBefore(domChild: HTMLElement, beforeDOMChild: HTMLElement) { }

    removeDOMChild(domChild: HTMLElement) { }
}
