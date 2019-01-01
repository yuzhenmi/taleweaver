import BoxLayoutPosition from '../layout/BoxLayoutPosition';

type Coordinates = {
  x: number;
  y: number;
};

export default function projectLayoutPosition(boxLayoutPosition: BoxLayoutPosition): Coordinates {
  return {
    x: 0,
    y: 0,
  };
}
