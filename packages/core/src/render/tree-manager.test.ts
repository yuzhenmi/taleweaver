import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { MarkService } from '../mark/service';
import { BlockModelNode, DocModelNode } from '../model/node';
import { IDocRenderNode, ITextRenderNode } from './node';
import { RenderTreeManager } from './tree-manager';

describe('RenderTreeManager', () => {
    let componentService: ComponentService;
    let markService: MarkService;
    let treeManager: RenderTreeManager;

    beforeEach(() => {
        const configService = new ConfigServiceStub();
        componentService = new ComponentService(configService);
        markService = new MarkService(configService);
        treeManager = new RenderTreeManager(componentService, markService);
    });

    describe('syncWithModelTree', () => {
        let modelDoc: DocModelNode;
        let modelBlock: BlockModelNode;

        beforeEach(() => {
            modelDoc = new DocModelNode('doc', 'doc');
            modelBlock = new BlockModelNode('paragraph', 'block');
            modelBlock.insertContent('Hello world!'.split(''), 0);
            modelDoc.insertChild(modelBlock, 0);
        });

        describe('when run for the first time', () => {
            it('builds render tree', () => {
                const doc = treeManager.syncWithModelTree(modelDoc);
                expect(doc.modelId).toEqual(modelDoc.id);
                const block = doc.children[0];
                expect(block.modelId).toEqual(modelBlock.id);
                const text = block.children[0] as ITextRenderNode;
                expect(text.content).toEqual('Hello world!\n');
            });

            describe('when has mark', () => {
                beforeEach(() => {
                    const modelBlock = modelDoc.children[0];
                    modelBlock.appendMark({
                        typeId: 'weight',
                        start: 6,
                        end: 11,
                        attributes: { weight: 700 },
                    });
                });

                it('breaks content at mark boundary', () => {
                    const doc = treeManager.syncWithModelTree(modelDoc);
                    expect(doc.modelId).toEqual(modelDoc.id);
                    const block = doc.children[0];
                    expect(block.modelId).toEqual(modelBlock.id);
                    const text1 = block.children[0] as ITextRenderNode;
                    expect(text1.content).toEqual('Hello ');
                    expect(text1.style.weight).toEqual(400);
                    const text2 = block.children[1] as ITextRenderNode;
                    expect(text2.content).toEqual('world');
                    expect(text2.style.weight).toEqual(700);
                    const text3 = block.children[2] as ITextRenderNode;
                    expect(text3.content).toEqual('!\n');
                    expect(text3.style.weight).toEqual(400);
                });
            });
        });

        describe('when run after model tree is updated', () => {
            let doc: IDocRenderNode;

            beforeEach(() => {
                doc = treeManager.syncWithModelTree(modelDoc);
                modelBlock.insertContent(' beautiful'.split(''), 5);
                treeManager.syncWithModelTree(modelDoc);
            });

            it('builds updated render tree', () => {
                expect(doc.modelId).toEqual(modelDoc.id);
                const block = doc.children[0];
                expect(block.modelId).toEqual(modelBlock.id);
                const text = block.children[0] as ITextRenderNode;
                expect(text.content).toEqual('Hello beautiful world!\n');
            });
        });
    });
});
