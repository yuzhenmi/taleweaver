import Editor from '../Editor';
import AtomicRenderNode from './AtomicRenderNode';

export default class LineBreakAtomicRenderNode extends AtomicRenderNode {

    constructor(editor: Editor, blockNodeID: string) {
        super(editor, `${blockNodeID}-LineBreakAtomic`);
    }

    getType() {
        return 'LineBreakAtomic';
    }

    getSize() {
        return 1;
    }

    getModelSize() {
        return 0;
    }

    getBreakable() {
        return true;
    }

    clearCache() { }

    convertOffsetToModelOffset(offset: number) {
        return -1;
    }
}
