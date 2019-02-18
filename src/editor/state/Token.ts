import DocStartToken from './DocStartToken';
import DocEndToken from './DocEndToken';
import BlockStartToken from './BlockStartToken';
import BlockEndToken from './BlockEndToken';
import InlineStartToken from './InlineStartToken';
import InlineEndToken from './InlineEndToken';

type Token = DocStartToken | DocEndToken | BlockStartToken | BlockEndToken | InlineStartToken | InlineEndToken | string;

export default Token;
