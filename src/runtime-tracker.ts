import { Logger } from './logger';
import { RunMetadata, removeCurrentRegistry, upsertCurrentRegistry, writeRunMetadata } from './logs';

export interface RunTracker {
  readonly update: (round: number, tokenUsed: number) => Promise<void>;
  readonly finalize: () => Promise<void>;
}

interface RunTrackerOptions {
  readonly logFile?: string;
  readonly command: string;
  readonly path: string;
  readonly logger?: Logger;
}

async function safeWrite(logFile: string, metadata: RunMetadata, logger?: Logger): Promise<void> {
  try {
    await writeRunMetadata(logFile, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(`写入运行元信息失败: ${message}`);
  }
  try {
    await upsertCurrentRegistry(logFile, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(`更新 current.json 失败: ${message}`);
  }
}

async function safeRemove(logFile: string, logger?: Logger): Promise<void> {
  try {
    await removeCurrentRegistry(logFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(`清理 current.json 失败: ${message}`);
  }
}

/**
 * 创建运行中任务的追踪器（写入 JSON 元数据）。
 */
export async function createRunTracker(options: RunTrackerOptions): Promise<RunTracker | null> {
  const { logFile, command, path, logger } = options;
  if (!logFile) return null;

  const update = async (round: number, tokenUsed: number): Promise<void> => {
    const metadata: RunMetadata = {
      command,
      round,
      tokenUsed,
      path,
      pid: process.pid
    };
    await safeWrite(logFile, metadata, logger);
  };

  await update(0, 0);

  return {
    update,
    finalize: async (): Promise<void> => {
      await safeRemove(logFile, logger);
    }
  };
}
