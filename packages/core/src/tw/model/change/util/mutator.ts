export abstract class Mutator<TState> {
    protected ran = false;
    protected inProgress = false;

    protected abstract next(): void;

    protected abstract readonly state: TState;

    run() {
        if (this.ran) {
            throw new Error('Already ran.');
        }
        this.inProgress = true;
        while (this.inProgress) {
            this.next();
        }
        this.ran = true;
    }
}
