import InlinePosition from '../InlinePosition';

type Coordinates = {
  x: number;
  y: number;
};

export default function projectResolvedPosition(resolvedPosition: InlinePosition): Coordinates {
  return {
    x: 0,
    y: 0,
  };
}
