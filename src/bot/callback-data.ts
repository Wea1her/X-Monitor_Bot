export interface CallbackPayload {
  action: string;
  id?: number;
  arg?: string;
}

const SEP = '|';
const ACTIONS = new Set([
  'menu',
  'help',
  'src.list',
  'src.show',
  'src.subs',
  'src.sub.toggle',
  'src.subscribe.toggle',
  'src.toggle',
  'src.delete',
  'add.start',
  'add.type',
  'dest.list',
  'dest.toggle',
  'dest.ignore'
]);

export function encodeCallback(payload: CallbackPayload): string {
  const parts = [payload.action];
  if (payload.id !== undefined) parts.push(`i=${payload.id}`);
  if (payload.arg !== undefined) parts.push(`a=${payload.arg}`);
  return parts.join(SEP);
}

export function decodeCallback(raw: string): CallbackPayload | null {
  if (!raw) return null;
  const parts = raw.split(SEP);
  const action = parts[0];
  if (!action) return null;
  if (!ACTIONS.has(action)) return null;
  const payload: CallbackPayload = { action };
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i] ?? '';
    if (segment.startsWith('i=')) {
      const num = Number.parseInt(segment.slice(2), 10);
      if (!Number.isFinite(num)) return null;
      payload.id = num;
    } else if (segment.startsWith('a=')) {
      payload.arg = segment.slice(2);
    } else {
      return null;
    }
  }
  return payload;
}
