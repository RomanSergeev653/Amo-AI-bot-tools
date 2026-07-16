/**
 * Local stub so `tsc` works without installing the OpenClaw peer package.
 * On the server, the real `openclaw/plugin-sdk/tool-plugin` module is used.
 */
declare module "openclaw/plugin-sdk/tool-plugin" {
  export type ToolExecuteContext = {
    signal?: AbortSignal & { throwIfAborted?: () => void };
  };

  export type ToolDefinition<TParams, TConfig> = {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    optional?: boolean;
    execute: (
      params: TParams,
      config: TConfig,
      context: ToolExecuteContext,
    ) => unknown | Promise<unknown>;
  };

  export type ToolFactory = <TParams, TConfig = Record<string, unknown>>(
    def: ToolDefinition<TParams, TConfig>,
  ) => ToolDefinition<TParams, TConfig>;

  export type DefineToolPluginInput<TConfig> = {
    id: string;
    name: string;
    description: string;
    configSchema?: unknown;
    tools: (tool: ToolFactory) => unknown[];
  };

  export function defineToolPlugin<TConfig = Record<string, unknown>>(
    input: DefineToolPluginInput<TConfig>,
  ): unknown;
}
