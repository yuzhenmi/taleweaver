import { ITextService, ITextStyle, TextService } from './service';

export class TextServiceStub extends TextService implements ITextService {
    constructor() {
        const canvasStub = {};
        const documentStub = {
            createElement: () => canvasStub,
        };
        super(documentStub as any);
    }

    measure(text: string, style: ITextStyle) {
        return { width: text.length * 20, height: style.size * 10 };
    }
}
