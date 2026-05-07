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

export interface WatchMutationOptions {
  token: string;
  account: string;
  fetch?: typeof fetch;
}

export type AddWatchAccountResult =
  | { ok: true; alreadyExists: boolean }
  | { ok: false; error: string };

export type DeleteWatchAccountResult =
  | { ok: true; alreadyMissing: boolean }
  | { ok: false; error: string };

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

export async function addWatchAccount(options: WatchMutationOptions): Promise<AddWatchAccountResult> {
  const fetchImpl = options.fetch ?? fetch;
  const account = options.account.trim().replace(/^@+/, '');
  try {
    const response = await fetchImpl(`${BASE_URL}/open/twitter_watch_add`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildWatchAddPayload(account))
    });
    const body = await response.text();
    if (response.ok) {
      return { ok: true, alreadyExists: false };
    }
    if (response.status === 400 && body.includes('该Twitter账号已在监控列表中')) {
      return { ok: true, alreadyExists: true };
    }
    return { ok: false, error: `watch-add failed for @${account}: ${response.status} ${body}` };
  } catch (error) {
    return {
      ok: false,
      error: `watch-add failed for @${account}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function deleteWatchAccount(options: WatchMutationOptions): Promise<DeleteWatchAccountResult> {
  const fetchImpl = options.fetch ?? fetch;
  const account = options.account.trim().replace(/^@+/, '');
  try {
    const response = await fetchImpl(`${BASE_URL}/open/twitter_watch_delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: account })
    });
    const body = await response.text();
    if (response.ok) {
      return { ok: true, alreadyMissing: false };
    }
    if (response.status === 400 && body.includes('该Twitter账号不在监控列表中')) {
      return { ok: true, alreadyMissing: true };
    }
    return { ok: false, error: `watch-delete failed for @${account}: ${response.status} ${body}` };
  } catch (error) {
    return {
      ok: false,
      error: `watch-delete failed for @${account}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function addWatchAccounts(options: AddWatchAccountsOptions): Promise<void> {
  const info = options.info ?? console.info;
  const warn = options.warn ?? console.warn;

  for (const account of options.accounts) {
    const result = await addWatchAccount({
      token: options.token,
      account,
      fetch: options.fetch
    });
    if (result.ok) {
      info(result.alreadyExists ? `watch-add already exists for @${account}` : `watch-add ok for @${account}`);
    } else {
      warn(result.error);
    }
  }
}
