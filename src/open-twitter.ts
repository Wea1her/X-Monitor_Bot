const BASE_URL = 'https://ai.6551.io';

export interface WatchAddPayload {
  username: string;
  newTweetBol: boolean;
  newFlwBol: boolean;
  newUnFlwBol: boolean;
  newTweetReplyBol: boolean;
  newTweetQuoteBol: boolean;
  newRetweetBol: boolean;
  updateNameBol: boolean;
  updateDescBol: boolean;
  updateAvatarBol: boolean;
  updateBannerBol: boolean;
  newCaBol: boolean;
  tweetToppingBol: boolean;
}

export interface AddWatchAccountsOptions {
  token: string;
  accounts: string[];
  fetch?: typeof fetch;
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

export function buildWatchAddPayload(username: string): WatchAddPayload {
  return {
    username,
    newTweetBol: false,
    newFlwBol: true,
    newUnFlwBol: true,
    newTweetReplyBol: false,
    newTweetQuoteBol: false,
    newRetweetBol: false,
    updateNameBol: false,
    updateDescBol: false,
    updateAvatarBol: false,
    updateBannerBol: false,
    newCaBol: false,
    tweetToppingBol: false
  };
}

export async function addWatchAccounts(options: AddWatchAccountsOptions): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const info = options.info ?? console.info;
  const warn = options.warn ?? console.warn;

  for (const account of options.accounts) {
    try {
      const response = await fetchImpl(`${BASE_URL}/open/twitter_watch_add`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildWatchAddPayload(account))
      });

      if (!response.ok) {
        warn(`watch-add failed for @${account}: ${response.status} ${await response.text()}`);
        continue;
      }

      info(`watch-add ok for @${account}`);
    } catch (error) {
      warn(
        `watch-add failed for @${account}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
