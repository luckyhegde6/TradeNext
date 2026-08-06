// Manual mock for @openrouter/agent (ESM-only package)
// Jest cannot parse ESM syntax, so we provide a CJS mock.
const mockCreate = jest.fn();

class MockOpenRouter {
  chat = {
    completions: {
      create: mockCreate,
    },
  };
  constructor() {}
}

module.exports = {
  OpenRouter: MockOpenRouter,
  SDKHooks: {},
};
