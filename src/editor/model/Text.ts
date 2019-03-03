import LeafNode from './LeafNode';

class Text extends LeafNode {

  getType(): string {
    return 'Text';
  }
}

export default Text;
