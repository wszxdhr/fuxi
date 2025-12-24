import { open as openFile } from 'node:fs/promises';
import fs from 'fs-extra';

export interface LogTailOptions {
  readonly filePath: string;
  readonly startFromEnd?: boolean;
  readonly pollIntervalMs?: number;
  readonly onLine: (line: string) => void;
  readonly onError?: (message: string) => void;
}

export interface LogTailHandle {
  stop: () => Promise<void>;
}

function normalizeChunk(chunk: string): string {
  return chunk.replace(/\r\n?/g, '\n');
}

/**
 * 轮询尾读日志文件，按行输出。
 */
export async function tailLogFile(options: LogTailOptions): Promise<LogTailHandle> {
  const intervalMs = options.pollIntervalMs ?? 200;
  let offset = 0;
  let buffer = '';
  let reading = false;
  let stopped = false;

  if (options.startFromEnd) {
    try {
      const stat = await fs.stat(options.filePath);
      offset = stat.size;
    } catch {
      offset = 0;
    }
  }

  const flushBuffer = (): void => {
    if (!buffer) return;
    options.onLine(buffer);
    buffer = '';
  };

  const emitChunk = (chunk: string): void => {
    buffer += normalizeChunk(chunk);
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const line of parts) {
      options.onLine(line);
    }
  };

  const readNew = async (): Promise<void> => {
    if (reading || stopped) return;
    reading = true;
    try {
      const stat = await fs.stat(options.filePath);
      if (stat.size < offset) {
        offset = stat.size;
        buffer = '';
      }
      if (stat.size > offset) {
        const length = stat.size - offset;
        const handle = await openFile(options.filePath, 'r');
        try {
          const payload = Buffer.alloc(length);
          const result = await handle.read(payload, 0, length, offset);
          offset += result.bytesRead;
          if (result.bytesRead > 0) {
            const text = payload.subarray(0, result.bytesRead).toString('utf8');
            emitChunk(text);
          }
        } finally {
          await handle.close();
        }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'ENOENT') {
        const message = err instanceof Error ? err.message : String(err);
        options.onError?.(message);
      }
    } finally {
      reading = false;
    }
  };

  const timer = setInterval(() => {
    void readNew();
  }, intervalMs);

  await readNew();

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      flushBuffer();
    }
  };
}
