import RenderBlock from '../render/RenderBlock';
import BoxBuilder from './BoxBuilder';
import LineBox from './LineBox';

export default abstract class LineBoxBuilder extends BoxBuilder {

  abstract build(renderBlock: RenderBlock): LineBox;
}
