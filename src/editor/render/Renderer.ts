import RenderDoc from './RenderDoc';
import Doc from '../model/Doc';

export default class Renderer {
  protected renderDoc: RenderDoc;

  constructor(renderDoc: RenderDoc) {
    this.renderDoc = renderDoc;
  }

  render(doc: Doc) {
    // TODO: Iterate through doc tree and insert/update/delete nodes as applicable
  }
}
