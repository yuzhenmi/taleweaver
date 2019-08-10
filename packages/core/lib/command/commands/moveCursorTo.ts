import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveTo(offset: number): Command {
    return (editor: Editor): Transformation => {
        const transformation = new Transformation();
        transformation.setCursor(offset);
        return transformation;
    };
}
