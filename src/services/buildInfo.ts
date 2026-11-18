/**
 * 构建期注入的服务配置。默认值来自 rspack.config.ts，必须与官方构建保持一致；
 * 测试构建通过 DSCHAT_* 环境变量覆盖，不在运行时读取任何环境变量。
 */
export const APP_VERSION = __APP_VERSION__
export const API_ORIGIN = __API_ORIGIN__
export const MESSAGES_BASE = __MESSAGES_BASE__
export const MODELS_URL = __MODELS_URL__
export const API_MODEL = __API_MODEL__
export const FEATURES = __FEATURES__
export const VERIFY_MODE = __VERIFY_MODE__

export type FeatureFlags = typeof FEATURES
