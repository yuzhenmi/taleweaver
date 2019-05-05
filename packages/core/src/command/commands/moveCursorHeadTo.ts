import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadTo(offset: number): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
        transformation.setCursorHead(offset);
    return transformation;
  };
}
