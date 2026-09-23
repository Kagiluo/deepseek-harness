/**
 * `terminal` namespace dictionaries, and the namespace's declaration.
 *
 * The exit lines separate a code from a signal because the two need different
 * words, and a process killed by a signal has no code to show.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'terminal'>` or `PropsLocale<'terminal'>` needs only this file,
 * whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Terminal type name, guide entry, live status, and failure lines. */
    terminal: TerminalKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '终端',
  'guide.title': '终端',
  'guide.description': '在这个会话的工作区里打开一个真实终端',
  connecting: '正在启动终端…',
  'status.exited': '终端已退出（退出码 {code}）',
  'status.signalled': '终端已结束（信号 {signal}）',
  'status.ended': '终端已退出',
  'error.failed': '终端连接中断：{message}',
} satisfies Record<string, string>

/** Terminal dictionary key union. */
export type TerminalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Terminal',
  'guide.title': 'Terminal',
  'guide.description': 'Open a real terminal in this session\'s workspace',
  connecting: 'Starting terminal…',
  'status.exited': 'Terminal exited (code {code})',
  'status.signalled': 'Terminal ended (signal {signal})',
  'status.ended': 'Terminal exited',
  'error.failed': 'Terminal connection failed: {message}',
} satisfies Record<TerminalKey, string>
