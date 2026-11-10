// EVIRMA: Source label rules for incoming customer messages.
import { getEvirmaMessageSource } from '../evirmaMessageSource';

const WEB = 'Channel::WebWidget';
const MAX_WEBHOOK = 'https://evirma.ru/api/v1/support/max/chatwoot-webhook';

describe('getEvirmaMessageSource', () => {
  it.each([
    [{ channelType: WEB, sourceHost: 'seller.wildberries.ru' }, 'WB'],
    [{ channelType: WEB, sourceHost: 'cmp.wildberries.ru' }, 'WB'],
    [{ channelType: WEB, sourceHost: 'www.wildberries.ru' }, 'WB'],
    [{ channelType: WEB, sourceHost: 'wb.ru' }, 'WB'],
    [{ channelType: WEB, sourceHost: 'evirma.ru' }, 'SITE'],
    [{ channelType: WEB, sourceHost: 'www.evirma.ru' }, 'SITE'],
    [{ channelType: WEB, sourceHost: 'notwildberries.ru' }, null],
    [{ channelType: WEB, sourceHost: 'example.com' }, null],
    [{ channelType: WEB, conversationSource: 'extension' }, 'WB'],
    [
      {
        channelType: WEB,
        sourceHost: 'evirma.ru',
        conversationSource: 'extension',
      },
      'SITE',
    ],
    [{ channelType: WEB }, null],
    [{ channelType: 'Channel::Telegram' }, 'TELEGRAM'],
    [{ channelType: 'Channel::Api', webhookUrl: MAX_WEBHOOK }, 'MAX'],
    [
      { channelType: 'Channel::Api', webhookUrl: 'https://example.com/hook' },
      null,
    ],
    [{ channelType: 'Channel::Api', webhookUrl: 'not a url' }, null],
    [{ channelType: 'Channel::Email', sourceHost: 'evirma.ru' }, null],
  ])('%j → %s', (params, expected) => {
    expect(getEvirmaMessageSource(params)).toBe(expected);
  });
});
