declare const __PACKAGE_VERSION__: string | undefined;

export const TOOL_NAME = 'agentconfig-doctor';
export const VERSION: string =
  typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.0.0-dev';
