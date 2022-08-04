import { Point } from '../nodes/base';
import { Mapping } from './mapping';

describe('Mapping', () => {
    let mapping: Mapping;
    let point: Point;

    describe('map', () => {
        describe('when point is shallower than mapping entry path', () => {
            beforeEach(() => {
                mapping = new Mapping([
                    {
                        start: { path: [1, 2], offset: 3 },
                        endBefore: 5,
                        endAfter: 6,
                    },
                ]);
            });

            beforeEach(() => {
                point = {
                    path: [1],
                    offset: 1,
                };
            });

            it('returns original point', () => {
                const newPoint = mapping.map(point);
                expect(newPoint).toStrictEqual(point);
            });
        });

        describe('when point is at same level as mapping entry path', () => {
            beforeEach(() => {
                mapping = new Mapping([
                    {
                        start: { path: [1, 2], offset: 3 },
                        endBefore: 5,
                        endAfter: 6,
                    },
                ]);
            });

            describe('when point is before mapping entry start', () => {
                beforeEach(() => {
                    point = {
                        path: [1, 2],
                        offset: 2,
                    };
                });

                it('returns original point', () => {
                    const newPoint = mapping.map(point);
                    expect(newPoint).toStrictEqual(point);
                });
            });

            describe('when point is between mapping entry start and end', () => {
                beforeEach(() => {
                    mapping = new Mapping([
                        {
                            start: { path: [1, 2], offset: 3 },
                            endBefore: 5,
                            endAfter: 6,
                        },
                    ]);
                });

                beforeEach(() => {
                    point = {
                        path: [1, 2],
                        offset: 4,
                    };
                });

                it('maps to the end', () => {
                    const newPoint = mapping.map(point);
                    expect(newPoint).toStrictEqual({
                        path: [1, 2],
                        offset: 6,
                    });
                });
            });

            describe('when point is after mapping entry end', () => {
                describe('mapping entry describes insertion', () => {
                    beforeEach(() => {
                        mapping = new Mapping([
                            {
                                start: { path: [1, 2], offset: 3 },
                                endBefore: 5,
                                endAfter: 6,
                            },
                        ]);
                    });

                    beforeEach(() => {
                        point = {
                            path: [1, 2],
                            offset: 6,
                        };
                    });

                    it('maps point towards the end', () => {
                        const newPoint = mapping.map(point);
                        expect(newPoint).toStrictEqual({
                            path: [1, 2],
                            offset: 7,
                        });
                    });
                });

                describe('mapping entry describes deletion', () => {
                    beforeEach(() => {
                        mapping = new Mapping([
                            {
                                start: { path: [1, 2], offset: 3 },
                                endBefore: 5,
                                endAfter: 4,
                            },
                        ]);
                    });

                    beforeEach(() => {
                        point = {
                            path: [1, 2],
                            offset: 6,
                        };
                    });

                    it('maps point towards the start', () => {
                        const newPoint = mapping.map(point);
                        expect(newPoint).toStrictEqual({
                            path: [1, 2],
                            offset: 5,
                        });
                    });
                });
            });
        });
    });
});
