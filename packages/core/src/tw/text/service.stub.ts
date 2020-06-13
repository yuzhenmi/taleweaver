import { IFont, ITextService, TextService } from './service';

export class TextServiceStub extends TextService implements ITextService {
    constructor() {
        const canvasStub = {};
        const documentStub = {
            createElement: () => canvasStub,
        };
        super(documentStub as any);
    }

    measure(text: string, font: IFont) {
        return { width: text.length * 20, height: font.size * 10 };
    }
}
