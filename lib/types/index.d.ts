/** dsh-md-studio 宿主半区的公开类型。 */
export const name: "dsh-md-studio";
export const inject: readonly ["webServer", "systemPrompt"];

/** apply 所需的最小宿主上下文;内联结构,避免依赖宿主包解析。 */
export interface PluginContext {
  effect(callback: () => (() => void) | void, label?: string): void;
  webServer: { register(route: unknown): () => void };
  systemPrompt: { section(section: unknown): () => void };
  root?: {
    inject(
      dependencies: readonly string[],
      callback: (ctx: { skills: { registerProvider(factory: () => unknown): void } }) => void,
    ): void;
  };
}

/** 注册运行时资源路由、系统提示段,并在 root 上注册自带 skill provider。 */
export function apply(ctx: PluginContext): void;
