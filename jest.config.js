// Unit tests only (`pnpm test`): fast, no Docker, BRouter mocked.
const testMatch = ['**/__tests__/**/*.[jt]s?(x)', '**/*-test.[jt]s?(x)'];

const nodeProject = (displayName, rootDir) => ({
  displayName,
  rootDir,
  testMatch,
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
  projects: [
    {
      displayName: 'mobile',
      rootDir: '<rootDir>/apps/mobile',
      preset: 'jest-expo',
      testMatch,
      // pnpm keeps packages under node_modules/.pnpm, see https://docs.expo.dev/develop/unit-testing/
      transformIgnorePatterns: [
        'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
      ],
    },
    nodeProject('api', '<rootDir>/apps/api'),
    nodeProject('route-generation', '<rootDir>/packages/route-generation'),
  ],
};
