// Unit tests only (`pnpm test`): fast, no Docker, BRouter mocked.
const testMatch = ['**/__tests__/**/*.[jt]s?(x)', '**/*-test.[jt]s?(x)'];

const nodeProject = (displayName, rootDir, coveragePathIgnorePatterns = ['/node_modules/']) => ({
  displayName,
  rootDir,
  testMatch,
  coveragePathIgnorePatterns,
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
});

module.exports = {
  // Matched against paths relative to each project's rootDir.
  collectCoverageFrom: ['**/*.{ts,tsx}', '!**/__tests__/**', '!**/*-test.{ts,tsx}', '!**/*.d.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
  projects: [
    {
      displayName: 'mobile',
      rootDir: '<rootDir>/apps/mobile',
      preset: 'jest-expo',
      testMatch,
      // index.ts only registers the root component.
      coveragePathIgnorePatterns: ['/node_modules/', '<rootDir>/index\\.ts$'],
      // pnpm keeps packages under node_modules/.pnpm, see https://docs.expo.dev/develop/unit-testing/
      transformIgnorePatterns: [
        'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
      ],
    },
    // src/index.ts only starts the server.
    nodeProject('api', '<rootDir>/apps/api', ['/node_modules/', '<rootDir>/src/index\\.ts$']),
    nodeProject('route-generation', '<rootDir>/packages/route-generation'),
  ],
};
