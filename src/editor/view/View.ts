export interface ViewDOMElements {}

abstract class View {

  abstract getSize(): number;

  abstract mount(domWrapper: HTMLElement): void;
  
  abstract getDOM(): ViewDOMElements;
}

export default View;
