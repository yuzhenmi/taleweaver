import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { MarkService } from '../mark/service';
import { DocModelNode } from '../model/nodes/doc';
import { BlockModelNode } from '../model/nodes/block';
import { RenderTreeManager } from './tree-manager';
import { TextRenderNode } from './nodes/text';
import { DocRenderNode } from './nodes/doc';

describe('RenderTreeManager', () => {
    let componentService: ComponentService;
    let markService: MarkService;
    let treeManager: RenderTreeManager;

    beforeEach(() => {
        const configService = new ConfigServiceStub();
        componentService = new ComponentService(configService as any);
        markService = new MarkService(configService as any);
        treeManager = new RenderTreeManager(componentService, markService);
    });

    describe('syncWithModelTree', () => {
        let modelDoc: DocModelNode<any>;
        let modelBlock: BlockModelNode<any>;

        beforeEach(() => {
            modelBlock = new BlockModelNode('paragraph', 'block', {}, [], 'Hello world!\n'.split(''));
            modelDoc = new DocModelNode('doc', 'doc', {}, [modelBlock]);
        });

        describe('when run for the first time', () => {
            it('builds render tree', () => {
                const doc = treeManager.updateFromModel(null, modelDoc);
                expect(doc.modelId).toEqual(modelDoc.id);
                const block = doc.children[0];
                expect(block.modelId).toEqual(modelBlock.id);
                const text = block.children[0] as TextRenderNode;
                expect(text.content).toEqual('Hello world!\n');
            });

            describe('when has mark', () => {
                beforeEach(() => {
                    modelBlock.setMarks([
                        {
                            typeId: 'weight',
                            start: 6,
                            end: 12,
                            attributes: { weight: 700 },
                        },
                    ]);
                });

                it('breaks content at mark boundary', () => {
                    const doc = treeManager.updateFromModel(null, modelDoc);
                    expect(doc.modelId).toEqual(modelDoc.id);
                    const block = doc.children[0];
                    expect(block.modelId).toEqual(modelBlock.id);
                    const text1 = block.children[0] as TextRenderNode;
                    expect(text1.content).toEqual('Hello ');
                    expect(text1.style.weight).toEqual(400);
                    const text2 = block.children[1] as TextRenderNode;
                    expect(text2.content).toEqual('world!');
                    expect(text2.style.weight).toEqual(700);
                });
            });
        });

        describe('when run after model tree is updated', () => {
            let doc: DocRenderNode;

            beforeEach(() => {
                doc = treeManager.updateFromModel(null, modelDoc);
                modelBlock.spliceChildren(5, 0, ' beautiful'.split(''));
                treeManager.updateFromModel(doc, modelDoc);
            });

            it('builds updated render tree', () => {
                expect(doc.modelId).toEqual(modelDoc.id);
                const block = doc.children[0];
                expect(block.modelId).toEqual(modelBlock.id);
                const text = block.children[0] as TextRenderNode;
                expect(text.content).toEqual('Hello beautiful world!\n');
            });
        });
    });
});
