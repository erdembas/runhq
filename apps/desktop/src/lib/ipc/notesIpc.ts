import { invoke } from '@tauri-apps/api/core';
import type { NoteFile } from '@/types';

export const notesIpc = {
  listNotes: (serviceId: string) => invoke<NoteFile[]>('list_notes', { serviceId }),
  readNote: (serviceId: string, name: string) => invoke<string>('read_note', { serviceId, name }),
  writeNote: (serviceId: string, name: string, content: string) =>
    invoke<void>('write_note', { serviceId, name, content }),
  deleteNote: (serviceId: string, name: string) =>
    invoke<boolean>('delete_note', { serviceId, name }),
  createNote: (serviceId: string, requestedName?: string) =>
    invoke<string>('create_note', {
      serviceId,
      requestedName: requestedName ?? null,
    }),
  readAllNotes: (serviceId: string) => invoke<string>('read_all_notes', { serviceId }),
  listNotedServices: () => invoke<string[]>('list_noted_services'),
};
