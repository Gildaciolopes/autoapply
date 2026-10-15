import { defineConfig } from 'vitest/config';

// Nest uses legacy decorators + emitDecoratorMetadata (tsconfig); tell the transformer.
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: { fileParallelism: false },
});
