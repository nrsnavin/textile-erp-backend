/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir:              'src',
  testRegex:            '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      tsconfig: {
        module:                 'commonjs',
        target:                 'ES2021',
        strict:                 true,
        experimentalDecorators: true,
        emitDecoratorMetadata:  true,
        skipLibCheck:           true,
        esModuleInterop:        true,
      },
    }],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory:   '../coverage',
  testEnvironment:     'node',
};
