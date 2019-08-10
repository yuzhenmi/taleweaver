import CloseTagToken from './CloseTagToken';
import OpenTagToken from './OpenTagToken';

type Token = OpenTagToken | CloseTagToken | string;

export default Token;
