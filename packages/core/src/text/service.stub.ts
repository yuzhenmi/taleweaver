import { TextStyle, TextService } from './service';

export class TextServiceStub extends TextService implements TextService {
    constructor() {
        const canvasStub = {};
        const documentStub = {
            createElement: () => canvasStub,
        };
        super(documentStub as any);
    }

    measure(text: string, style: TextStyle) {
        return { width: text.length * 20, height: style.size * 10 };
    }
}
