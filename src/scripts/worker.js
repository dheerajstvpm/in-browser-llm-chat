import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// The handler intercepts messages from the main thread and routes them to the MLCEngine
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg) => {
  handler.onmessage(msg);
};
