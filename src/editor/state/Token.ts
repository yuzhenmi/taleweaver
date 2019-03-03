import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';

type Token = OpenTagToken | CloseTagToken | string;

export default Token;
