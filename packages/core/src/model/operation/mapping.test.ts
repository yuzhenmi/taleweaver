import { IPosition } from '../position';
import { Mapping } from './mapping';

describe('Mapping', () => {
    let mapping: Mapping;
    let position: IPosition;

    describe('map', () => {
        describe('when position is shallower than mapping entry path', () => {
            beforeEach(() => {
                mapping = new Mapping([
                    {
                        path: [1, 2],
                        start: 3,
                        endBefore: 5,
                        endAfter: 6,
                    },
                ]);
            });

            describe('when position is path', () => {
                beforeEach(() => {
                    position = [1, 1];
                });
                it('returns original position', () => {
                    const newPosition = mapping.map(position);
                    expect(newPosition).toStrictEqual(position);
                });
            });

            describe('when position is point', () => {
                beforeEach(() => {
                    position = {
                        path: [1],
                        offset: 1,
                    };
                });

                it('returns original position', () => {
                    const newPosition = mapping.map(position);
                    expect(newPosition).toStrictEqual(position);
                });
            });
        });

        describe('when position is at same level as mapping entry path', () => {
            beforeEach(() => {
                mapping = new Mapping([
                    {
                        path: [1, 2],
                        start: 3,
                        endBefore: 5,
                        endAfter: 6,
                    },
                ]);
            });

            describe('when position is before mapping entry start', () => {
                describe('when position is path', () => {
                    beforeEach(() => {
                        position = [1, 2, 2];
                    });

                    it('returns original position', () => {
                        const newPosition = mapping.map(position);
                        expect(newPosition).toStrictEqual(position);
                    });
                });

                describe('when position is point', () => {
                    beforeEach(() => {
                        position = {
                            path: [1, 2],
                            offset: 2,
                        };
                    });

                    it('returns original position', () => {
                        const newPosition = mapping.map(position);
                        expect(newPosition).toStrictEqual(position);
                    });
                });
            });

            describe('when position is between mapping entry start and end', () => {
                beforeEach(() => {
                    mapping = new Mapping([
                        {
                            path: [1, 2],
                            start: 3,
                            endBefore: 5,
                            endAfter: 6,
                        },
                    ]);
                });

                describe('when position is path', () => {
                    beforeEach(() => {
                        position = [1, 2, 4];
                    });

                    it('throws error', () => {
                        expect(() => mapping.map(position)).toThrow(Error);
                    });
                });

                describe('when position is point', () => {
                    beforeEach(() => {
                        position = {
                            path: [1, 2],
                            offset: 4,
                        };
                    });

                    it('throws error', () => {
                        expect(() => mapping.map(position)).toThrow(Error);
                    });
                });
            });

            describe('when position is after mapping entry end', () => {
                describe('mapping entry describes insertion', () => {
                    beforeEach(() => {
                        mapping = new Mapping([
                            {
                                path: [1, 2],
                                start: 3,
                                endBefore: 5,
                                endAfter: 6,
                            },
                        ]);
                    });

                    describe('when position is path', () => {
                        beforeEach(() => {
                            position = [1, 2, 6];
                        });

                        it('maps position towards the end', () => {
                            const newPosition = mapping.map(position);
                            expect(newPosition).toStrictEqual([1, 2, 7]);
                        });
                    });

                    describe('when position is point', () => {
                        beforeEach(() => {
                            position = {
                                path: [1, 2],
                                offset: 6,
                            };
                        });

                        it('maps position towards the end', () => {
                            const newPosition = mapping.map(position);
                            expect(newPosition).toStrictEqual({
                                path: [1, 2],
                                offset: 7,
                            });
                        });
                    });
                });

                describe('mapping entry describes deletion', () => {
                    beforeEach(() => {
                        mapping = new Mapping([
                            {
                                path: [1, 2],
                                start: 3,
                                endBefore: 5,
                                endAfter: 4,
                            },
                        ]);
                    });

                    describe('when position is path', () => {
                        beforeEach(() => {
                            position = [1, 2, 6];
                        });

                        it('maps position towards the start', () => {
                            const newPosition = mapping.map(position);
                            expect(newPosition).toStrictEqual([1, 2, 5]);
                        });
                    });

                    describe('when position is point', () => {
                        beforeEach(() => {
                            position = {
                                path: [1, 2],
                                offset: 6,
                            };
                        });

                        it('maps position towards the start', () => {
                            const newPosition = mapping.map(position);
                            expect(newPosition).toStrictEqual({
                                path: [1, 2],
                                offset: 5,
                            });
                        });
                    });
                });
            });
        });
    });
});
