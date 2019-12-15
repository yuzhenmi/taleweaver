import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener } from 'tw/event/listener';
import { IToken } from 'tw/state/token';

export interface IDidInsertEvent {
    tokens: IToken[];
}

export interface IKeyboardObserver {
    onDidInsert(listener: IEventListener<IDidInsertEvent>): void;
}

export class KeyboardObserver implements IKeyboardObserver {
    protected composing: boolean = false;
    protected mutationObserver: MutationObserver;
    protected didInsertEventEmitter: IEventEmitter<IDidInsertEvent> = new EventEmitter();

    constructor(protected $contentEditable: HTMLDivElement) {
        this.mutationObserver = new MutationObserver(this.handleDidMutate);
        $contentEditable.addEventListener('keydown', this.handleKeyDown);
        $contentEditable.addEventListener('compositionstart', this.handleCompositionStart);
        $contentEditable.addEventListener('compositionend', this.handleCompositionEnd);
        $contentEditable.addEventListener('focus', this.handleFocus);
        $contentEditable.addEventListener('blur', this.handleBlur);
        $contentEditable.addEventListener('copy', this.handleCopy);
        $contentEditable.addEventListener('paste', this.handlePaste);
        this.mutationObserver.observe($contentEditable, {
            subtree: true,
            characterData: true,
            childList: true,
        });
    }

    onDidInsert(listener: IEventListener<IDidInsertEvent>) {
        this.didInsertEventEmitter.on(listener);
    }

    protected handleDidMutate = () => {
        setTimeout(() => {
            if (this.composing) {
                return;
            }
            const tokens = this.parse();
            this.$contentEditable.innerHTML = '';
            if (tokens.length === 0) {
                return;
            }
            this.didInsertEventEmitter.emit({ tokens });
        });
    };

    protected parse() {
        const tokens: IToken[] = [];
        this.$contentEditable.childNodes.forEach(child => {
            tokens.push(...this.parseNode(child));
        });
        return tokens;
    }

    protected parseNode(node: Node): IToken[] {
        if (node.nodeValue) {
            return node.nodeValue.split('');
        }
        const tokens: IToken[] = [];
        node.childNodes.forEach(childNode => {
            tokens.push(...this.parseNode(childNode));
        });
        return tokens;
    }

    protected handleKeyDown(event: KeyboardEvent) {}

    protected handleCompositionStart() {}

    protected handleCompositionEnd() {}

    protected handleFocus() {}

    protected handleBlur() {}

    protected handleCopy(event: ClipboardEvent) {}

    protected handlePaste(event: ClipboardEvent) {}
}
