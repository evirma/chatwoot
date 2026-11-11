// EVIRMA: Label where an incoming customer message came from (WB pages, evirma.ru, Telegram, MAX).
import { INBOX_TYPES } from 'dashboard/helper/inbox';

export const EVIRMA_MESSAGE_SOURCES = {
  WB: 'WB',
  SITE: 'SITE',
  TELEGRAM: 'TELEGRAM',
  MAX: 'MAX',
};

export const EVIRMA_MESSAGE_SOURCE_ICONS = {
  WB: 'i-lucide-shopping-bag',
  SITE: 'i-lucide-globe',
  TELEGRAM: 'i-ri-telegram-fill',
  MAX: 'i-lucide-message-circle',
};

// The MAX relay is the only API inbox that posts replies back to evirma.ru.
const MAX_WEBHOOK_PATH = '/support/max/chatwoot-webhook';
const WB_DOMAINS = ['wildberries.ru', 'wb.ru'];
const SITE_DOMAINS = ['evirma.ru'];

const isHostOf = (host, domains) =>
  domains.some(domain => host === domain || host.endsWith(`.${domain}`));

const isMaxWebhook = webhookUrl => {
  try {
    return new URL(webhookUrl).pathname.endsWith(MAX_WEBHOOK_PATH);
  } catch {
    return false;
  }
};

const getWebSource = (sourceHost, conversationSource) => {
  const host = (sourceHost || '').toLowerCase();
  if (host && isHostOf(host, WB_DOMAINS)) return EVIRMA_MESSAGE_SOURCES.WB;
  if (host && isHostOf(host, SITE_DOMAINS)) return EVIRMA_MESSAGE_SOURCES.SITE;
  // Messages saved before the host was stored: the extension marks its conversations.
  if (!host && conversationSource === 'extension') {
    return EVIRMA_MESSAGE_SOURCES.WB;
  }
  return null;
};

/**
 * @param {Object} params
 * @param {string|undefined} params.channelType - Inbox channel type
 * @param {string|undefined} params.webhookUrl - API inbox webhook URL
 * @param {string|undefined} params.sourceHost - Host saved with a web widget message
 * @param {string|undefined} params.conversationSource - Conversation custom attribute `source`
 * @returns {string|null} One of EVIRMA_MESSAGE_SOURCES or null when unknown
 */
export const getEvirmaMessageSource = ({
  channelType,
  webhookUrl,
  sourceHost,
  conversationSource,
}) => {
  if (channelType === INBOX_TYPES.TELEGRAM) {
    return EVIRMA_MESSAGE_SOURCES.TELEGRAM;
  }
  if (channelType === INBOX_TYPES.API && isMaxWebhook(webhookUrl)) {
    return EVIRMA_MESSAGE_SOURCES.MAX;
  }
  if (channelType === INBOX_TYPES.WEB) {
    return getWebSource(sourceHost, conversationSource);
  }
  return null;
};
