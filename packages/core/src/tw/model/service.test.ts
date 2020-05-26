import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ModelService } from './service';

describe('ModelService', () => {
    let doc: ModelDoc;
    let modelService: ModelService;

    beforeEach(() => {
        doc = new ModelDoc('doc', 'doc', {}, [
            new ModelParagraph('paragraph', 'paragraph', {}, [new ModelText('text', 'text', 'Hello world', {})]),
        ]);
        modelService = new ModelService(doc);
    });

    describe('getRoot', () => {
        it('returns root node', () => {
            const root = modelService.getRoot();
            expect(root).toEqual(doc);
        });
    });

    describe('applyTransformation', () => {
        it('applies transformation', () => {
            // TODO
        });
    });

    describe('onDidTransformModelState', () => {
        it('listens to DidTransformModelState event', () => {
            // TODO
        });
    });
});
