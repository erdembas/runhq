import * as i18n from '../i18n/core';
import type { AgentAttachment } from '@runhq/cockpit-types';

export const MAX_AGENT_ATTACHMENTS = 5;
// Leave room for the prompt and protocol framing below the runtime's 8 MiB frame limit.
export const MAX_AGENT_IMAGE_BASE64_LENGTH = 3 * 1024 * 1024;
export const MAX_AGENT_IMAGE_BYTES = (MAX_AGENT_IMAGE_BASE64_LENGTH / 4) * 3;
export const AGENT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export function agentSupportsImages(adapter: string): boolean {
  return adapter === 'codex' || adapter === 'claude';
}

export function validateAgentAttachments(attachments: readonly AgentAttachment[]): string | null {
  if (attachments.length > MAX_AGENT_ATTACHMENTS)
    return i18n.t('Attach up to 5 images per message.');
  let total = 0;
  for (const attachment of attachments) {
    if (
      !attachment.name?.trim() ||
      attachment.name.length > 255 ||
      [...attachment.name].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      return i18n.t('Every image must have a valid filename (up to 255 characters).');
    if (!(AGENT_IMAGE_MIME_TYPES as readonly string[]).includes(attachment.mime_type))
      return i18n.t('Choose PNG, JPEG, WebP or GIF images.');
    if (typeof attachment.data !== 'string')
      return i18n.t('Image data is invalid. Attach the file again.');
    total += attachment.data.length;
    if (total > MAX_AGENT_IMAGE_BASE64_LENGTH)
      return i18n.t('Images must total 2.25 MiB or less. Choose smaller images.');
    if (
      !attachment.data ||
      attachment.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.data)
    )
      return i18n.t('Image data is invalid. Attach the file again.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (
      (attachment.data.endsWith('==') && alphabet.indexOf(attachment.data.at(-3)!) % 16 !== 0) ||
      (!attachment.data.endsWith('==') &&
        attachment.data.endsWith('=') &&
        alphabet.indexOf(attachment.data.at(-2)!) % 4 !== 0)
    )
      return i18n.t('Image data is invalid. Attach the file again.');
  }
  return null;
}
