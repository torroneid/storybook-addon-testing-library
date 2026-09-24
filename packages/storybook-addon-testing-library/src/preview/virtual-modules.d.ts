declare module 'virtual:storybook-addon-testing-library/setup' {
  export const setupFiles: Array<() => Promise<unknown>>;
}

declare module 'virtual:storybook-addon-testing-library/debugger' {
  export const pause: () => void;
}
