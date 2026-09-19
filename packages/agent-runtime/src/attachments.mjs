import { Buffer } from 'node:buffer';

export const MAX_IMAGE_BASE64_LENGTH = 3 * 1024 * 1024;

/** Called before launching a provider, including when the runtime is invoked without Rust. */
export function validateAttachments(attachments, adapter) {
  if (attachments == null) return [];
  if (!Array.isArray(attachments)) throw new Error('Image attachments must be an array');
  if (!attachments.length) return [];
  if (!['codex', 'claude'].includes(adapter))
    throw new Error(
      'Image attachments are supported by Codex and Claude. Choose one of these agents or remove the images.',
    );
  if (attachments.length > 5) throw new Error('Attach up to 5 images per message');
  let total = 0;
  for (const image of attachments) {
    if (
      !image ||
      typeof image.name !== 'string' ||
      !image.name.trim() ||
      image.name.length > 255 ||
      [...image.name].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error('Every image must have a valid filename (up to 255 characters)');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mime_type))
      throw new Error('Choose PNG, JPEG, WebP or GIF images');
    if (typeof image.data !== 'string' || !image.data)
      throw new Error('Image data is invalid. Attach the file again.');
    total += image.data.length;
    if (total > MAX_IMAGE_BASE64_LENGTH)
      throw new Error('Images must total 2.25 MiB or less. Choose smaller images.');
    if (Buffer.from(image.data, 'base64').toString('base64') !== image.data)
      throw new Error('Image data is invalid. Attach the file again.');
  }
  return attachments;
}

export function codexImageInput(prompt, attachments) {
  return [
    { type: 'text', text: prompt },
    ...validateAttachments(attachments, 'codex').map((image) => ({
      type: 'image',
      url: `data:${image.mime_type};base64,${image.data}`,
    })),
  ];
}

export async function* claudeImageInput(prompt, attachments) {
  // SDKUserMessage.message is Anthropic MessageParam; image source uses native base64 content.
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...validateAttachments(attachments, 'claude').map((image) => ({
          type: 'image',
          source: { type: 'base64', media_type: image.mime_type, data: image.data },
        })),
      ],
    },
  };
}
