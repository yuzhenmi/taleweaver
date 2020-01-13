module.exports = {
    globals: {
        'ts-jest': {
            tsConfig: 'tsconfig.test.json',
        },
    },
    moduleFileExtensions: ['ts', 'js'],
    moduleNameMapper: {
        '^tw/(.*)$': '<rootDir>/src/tw/$1',
    },
    transform: {
        '^.+\\.(ts)$': 'ts-jest',
    },
    testMatch: ['**/*.test.ts'],
    testEnvironment: 'node',
};
