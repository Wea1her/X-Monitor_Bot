import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { parseConfig } from './config.js';
import { addWatchAccounts } from './open-twitter.js';
import { startWebSocketProbe } from './probe.js';

export function formatStartupMessage(accounts: string[]): string {
  return `Starting OpenTwitter WSS probe for ${accounts
    .map((account) => `@${account}`)
    .join(', ')}`;
}

export async function main(): Promise<void> {
  const config = parseConfig(process.env);

  console.info(formatStartupMessage(config.watchAccounts));

  await addWatchAccounts({
    token: config.twitterToken,
    accounts: config.watchAccounts
  });

  const stop = startWebSocketProbe(config);

  const shutdown = (signal: NodeJS.Signals) => {
    console.info(`Received ${signal}, shutting down`);
    stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
